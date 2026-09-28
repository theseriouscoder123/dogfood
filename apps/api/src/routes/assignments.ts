// Organizer tools for judge assignment. Mounted at /api/events/:slug.
//
//   POST /assignments/preview   run the algorithm without saving (any time)
//   POST /assignments/commit    save exactly what was previewed (only after submissions close)
//   GET  /assignments           every assignment, grouped by project, with coverage
//   GET  /assignments/eligible  which judges could take a given project, and why not
//   POST /assignments           add one assignment by hand (same constraints as the algorithm)
//   POST /assignments/:id/reassign, DELETE /assignments/:id
//   GET  /assignment-batches    history of algorithmic runs
//
// "What you previewed is what you get": commit recomputes the plan from the same inputs and
// refuses if a fingerprint of those inputs changed in between (a judge added, a recusal, ...).
import { Router, type Request } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma, type Db } from "../db";
import { accessFor, decideOrganize, enforce, submissionWindow } from "../policy";
import { appendAudit, fromRequest } from "../audit";
import { eventBySlug } from "../lib/events";
import { HttpError, notFound } from "../lib/http";
import { canonicalJson, sha256 } from "../lib/crypto";
import { loadStats, planAssignments, type AssignInput } from "../judging/assign";

export const assignmentsRouter = Router({ mergeParams: true });

async function staffEvent(req: Request) {
  const event = await eventBySlug((req.params as { slug?: string }).slug);
  enforce(decideOrganize(await accessFor(req.actor, event.id)));
  return event;
}

function requireClosed(event: { submissionsOpenAt: Date; submissionsCloseAt: Date }) {
  if (submissionWindow(event) !== "closed")
    throw new HttpError(409, "submissions_still_open", "Assign judges after the submission deadline, once the list of projects is final.");
}

/** Everything the algorithm needs, read in one consistent snapshot. */
export async function loadAssignInput(db: Db, eventId: string) {
  const [projects, roles, judgeTracks, assignments, conflicts] = await Promise.all([
    db.project.findMany({ where: { eventId, status: "submitted", duplicateOfId: null }, select: { id: true, trackId: true, teamId: true } }),
    db.eventRole.findMany({ where: { eventId, role: "judge" }, select: { userId: true } }),
    db.judgeTrack.findMany({ where: { eventId }, select: { userId: true, trackId: true } }),
    db.assignment.findMany({ where: { eventId }, select: { judgeId: true, projectId: true, status: true } }),
    db.conflictOfInterest.findMany({ where: { eventId }, select: { judgeId: true, teamId: true } }),
  ]);
  const tracksOf = new Map<string, string[]>();
  for (const t of judgeTracks) tracksOf.set(t.userId, [...(tracksOf.get(t.userId) ?? []), t.trackId]);
  const sortBy = <T,>(xs: T[], key: (x: T) => string) => [...xs].sort((a, b) => key(a).localeCompare(key(b)));
  return {
    projects: sortBy(projects, (p) => p.id),
    judges: sortBy(roles.map((r) => ({ id: r.userId, trackIds: (tracksOf.get(r.userId) ?? []).sort() })), (j) => j.id),
    existing: sortBy(assignments.filter((a) => a.status !== "recused").map(({ judgeId, projectId }) => ({ judgeId, projectId })), (a) => a.judgeId + a.projectId),
    blocked: sortBy(assignments.filter((a) => a.status === "recused").map(({ judgeId, projectId }) => ({ judgeId, projectId })), (a) => a.judgeId + a.projectId),
    conflicts: sortBy(conflicts, (c) => c.judgeId + c.teamId),
  };
}

export const PlanParams = z.object({
  reviewsPerProject: z.number().int().min(1).max(10).default(3),
  maxPerJudge: z.number().int().min(1).max(500).nullable().default(null),
  seed: z.number().int().min(0).max(2 ** 31 - 1).optional(),
  mode: z.enum(["fill", "simulate"]).default("fill"),
});

function buildInput(snapshot: Awaited<ReturnType<typeof loadAssignInput>>, params: z.infer<typeof PlanParams> & { seed: number }): AssignInput {
  return {
    ...snapshot,
    // "simulate" plans from a blank slate (keeping recusals and conflicts), for comparison only.
    existing: params.mode === "simulate" ? [] : snapshot.existing,
    reviewsPerProject: params.reviewsPerProject,
    maxPerJudge: params.maxPerJudge,
    seed: params.seed,
  };
}

const fingerprint = (input: AssignInput) => sha256(canonicalJson(input));

assignmentsRouter.post("/assignments/preview", async (req, res) => {
  const event = await staffEvent(req);
  const params = PlanParams.parse(req.body ?? {});
  const seed = params.seed ?? Math.floor(Math.random() * 2 ** 31);
  const snapshot = await loadAssignInput(prisma, event.id);
  const input = buildInput(snapshot, { ...params, seed });
  const plan = planAssignments(input);

  const [users, projects] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: input.judges.map((j) => j.id) } }, select: { id: true, name: true } }),
    prisma.project.findMany({ where: { id: { in: input.projects.map((p) => p.id) } }, select: { id: true, title: true, track: { select: { name: true } } } }),
  ]);
  const name = new Map(users.map((u) => [u.id, u.name]));
  const proj = new Map(projects.map((p) => [p.id, p]));

  res.json({
    params: { ...params, seed },
    inputHash: fingerprint(input),
    canCommit: params.mode === "fill" && submissionWindow(event) === "closed",
    summary: {
      projects: input.projects.length,
      judges: input.judges.length,
      existing: input.existing.length,
      newAssignments: plan.assignments.length,
      shortfalls: plan.shortfalls.length,
      components: plan.components,
      coverage: plan.coverage,
      loadBefore: loadStats(plan.loadBefore),
      loadAfter: loadStats(plan.loadAfter),
    },
    judges: input.judges
      .map((j) => ({ id: j.id, name: name.get(j.id) ?? "?", before: plan.loadBefore[j.id] ?? 0, after: plan.loadAfter[j.id] ?? 0 }))
      .sort((a, b) => b.after - a.after || a.name.localeCompare(b.name)),
    assignments: plan.assignments.map((a) => ({ ...a, judgeName: name.get(a.judgeId), projectTitle: proj.get(a.projectId)?.title })),
    shortfalls: plan.shortfalls.map((s) => ({ ...s, projectTitle: proj.get(s.projectId)?.title, track: proj.get(s.projectId)?.track?.name ?? null })),
  });
});

export const CommitPlanBody = PlanParams.extend({ seed: z.number().int().min(0).max(2 ** 31 - 1), inputHash: z.string().length(64) });

assignmentsRouter.post("/assignments/commit", async (req, res) => {
  const event = await staffEvent(req);
  requireClosed(event);
  const body = CommitPlanBody.parse(req.body);
  if (body.mode !== "fill") throw new HttpError(400, "cannot_commit_simulation", "A from-scratch simulation is for comparison only.");

  const result = await prisma.$transaction(
    async (tx) => {
      // One commit per event at a time, computed from the state inside this transaction.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"assign:" + event.id}))`;
      const input = buildInput(await loadAssignInput(tx, event.id), body);
      if (fingerprint(input) !== body.inputHash)
        throw new HttpError(409, "stale_preview", "Something changed since you previewed (judges, conflicts or assignments). Preview again.");
      const plan = planAssignments(input);
      if (plan.assignments.length === 0) return { batch: null, created: 0, plan };

      const batch = await tx.assignmentBatch.create({
        data: {
          eventId: event.id,
          name: `Auto-assign · ${body.reviewsPerProject} per project`,
          algorithm: "balanced-greedy-v1",
          params: { reviewsPerProject: body.reviewsPerProject, maxPerJudge: body.maxPerJudge, inputHash: body.inputHash },
          seed: body.seed,
          createdById: req.actor!.id,
        },
      });
      await tx.assignment.createMany({ data: plan.assignments.map((a) => ({ ...a, eventId: event.id, batchId: batch.id })) });
      await appendAudit(tx, {
        ...fromRequest(req), eventId: event.id, action: "assignments.batch_committed", entityType: "AssignmentBatch", entityId: batch.id,
        after: { created: plan.assignments.length, seed: body.seed, shortfalls: plan.shortfalls.length, components: plan.components, load: loadStats(plan.loadAfter) },
      });
      return { batch, created: plan.assignments.length, plan };
    },
    { timeout: 60_000 },
  );
  res.status(result.created ? 201 : 200).json({
    batch: result.batch && { id: result.batch.id, name: result.batch.name, seed: result.batch.seed },
    created: result.created,
    shortfalls: result.plan.shortfalls.length,
    components: result.plan.components,
  });
});

assignmentsRouter.get("/assignments", async (req, res) => {
  const event = await staffEvent(req);
  const [projects, assignments, conflicts, criteriaCount] = await Promise.all([
    prisma.project.findMany({
      where: { eventId: event.id, status: "submitted" },
      orderBy: { title: "asc" },
      select: { id: true, title: true, externalId: true, duplicateOfId: true, teamId: true, track: { select: { id: true, name: true } }, team: { select: { name: true } } },
    }),
    prisma.assignment.findMany({
      where: { eventId: event.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, projectId: true, status: true, recusalReason: true, createdAt: true, batchId: true,
        judge: { select: { id: true, name: true } },
        review: { select: { status: true, submittedAt: true } },
      },
    }),
    prisma.conflictOfInterest.findMany({ where: { eventId: event.id }, select: { judgeId: true, teamId: true } }),
    prisma.criterion.count({ where: { eventId: event.id } }),
  ]);
  const conflict = new Set(conflicts.map((c) => `${c.judgeId}|${c.teamId}`));
  const byProject = new Map<string, typeof assignments>();
  for (const a of assignments) byProject.set(a.projectId, [...(byProject.get(a.projectId) ?? []), a]);

  res.json({
    submissionsClosed: submissionWindow(event) === "closed",
    hasRubric: criteriaCount > 0,
    projects: projects.map((p) => {
      const list = byProject.get(p.id) ?? [];
      return {
        id: p.id, title: p.title, externalId: p.externalId, track: p.track, team: p.team.name, duplicate: p.duplicateOfId !== null,
        active: list.filter((a) => a.status !== "recused").length,
        submitted: list.filter((a) => a.status === "submitted").length,
        assignments: list.map((a) => ({
          id: a.id, status: a.status, recusalReason: a.recusalReason, batchId: a.batchId, judge: a.judge,
          conflict: conflict.has(`${a.judge.id}|${p.teamId}`),
        })),
      };
    }),
  });
});

/** Every judge, and whether they could take this project (with the reason if not). */
assignmentsRouter.get("/assignments/eligible", async (req, res) => {
  const event = await staffEvent(req);
  const projectId = z.uuid().parse(req.query.projectId);
  const project = await prisma.project.findFirst({ where: { id: projectId, eventId: event.id }, select: { id: true, trackId: true, teamId: true } });
  if (!project) throw notFound("Project");
  const snapshot = await loadAssignInput(prisma, event.id);
  const users = await prisma.user.findMany({ where: { id: { in: snapshot.judges.map((j) => j.id) } }, select: { id: true, name: true } });
  const name = new Map(users.map((u) => [u.id, u.name]));
  const load = new Map<string, number>();
  for (const a of snapshot.existing) load.set(a.judgeId, (load.get(a.judgeId) ?? 0) + 1);

  res.json({
    judges: snapshot.judges
      .map((j) => {
        const reason = ineligibility(snapshot, j, project);
        return { id: j.id, name: name.get(j.id) ?? "?", load: load.get(j.id) ?? 0, eligible: reason === null, reason };
      })
      .sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.load - b.load || a.name.localeCompare(b.name)),
  });
});

function ineligibility(
  snapshot: Awaited<ReturnType<typeof loadAssignInput>>,
  judge: { id: string; trackIds: string[] },
  project: { id: string; trackId: string | null; teamId: string },
): string | null {
  if (snapshot.existing.some((a) => a.judgeId === judge.id && a.projectId === project.id)) return "already assigned";
  if (snapshot.blocked.some((a) => a.judgeId === judge.id && a.projectId === project.id)) return "recused from this project";
  if (snapshot.conflicts.some((c) => c.judgeId === judge.id && c.teamId === project.teamId)) return "conflict of interest";
  if (judge.trackIds.length && (project.trackId === null || !judge.trackIds.includes(project.trackId))) return "different track";
  return null;
}

async function assertAssignable(eventId: string, judgeId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, eventId }, select: { id: true, trackId: true, teamId: true, status: true, duplicateOfId: true } });
  if (!project) throw notFound("Project");
  if (project.status !== "submitted" || project.duplicateOfId) throw new HttpError(409, "project_not_judgeable", "Only submitted, non-duplicate projects can be assigned.");
  const snapshot = await loadAssignInput(prisma, eventId);
  const judge = snapshot.judges.find((j) => j.id === judgeId);
  if (!judge) throw new HttpError(400, "invalid_judge", "That person isn't a judge of this event.");
  const reason = ineligibility(snapshot, judge, project);
  if (reason) throw new HttpError(409, "not_eligible", `This judge can't take this project: ${reason}.`);
}

export const AddAssignmentBody = z.object({ judgeId: z.uuid(), projectId: z.uuid() });

assignmentsRouter.post("/assignments", async (req, res) => {
  const event = await staffEvent(req);
  requireClosed(event);
  const body = AddAssignmentBody.parse(req.body);
  await assertAssignable(event.id, body.judgeId, body.projectId);
  const assignment = await prisma.$transaction(async (tx) => {
    const a = await tx.assignment.create({ data: { ...body, eventId: event.id } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "assignment.manual_add", entityType: "Assignment", entityId: a.id, after: body });
    return a;
  });
  res.status(201).json({ assignment });
});

async function assignmentInEvent(eventId: string, id: string) {
  const a = await prisma.assignment.findFirst({ where: { id, eventId }, include: { review: { select: { status: true } } } });
  if (!a) throw notFound("Assignment");
  return a;
}

/** Remove an assignment nobody has submitted a review for. Submitted reviews are never deleted. */
assignmentsRouter.delete("/assignments/:assignmentId", async (req, res) => {
  const event = await staffEvent(req);
  const a = await assignmentInEvent(event.id, (req.params as { assignmentId: string }).assignmentId);
  if (a.status === "submitted" || a.review?.status === "submitted")
    throw new HttpError(409, "review_submitted", "This review has been submitted and is part of the record. Exclude it from results instead.");
  await prisma.$transaction(async (tx) => {
    await tx.assignment.delete({ where: { id: a.id } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "assignment.removed", entityType: "Assignment", entityId: a.id, before: { judgeId: a.judgeId, projectId: a.projectId, status: a.status } });
  });
  res.status(204).end();
});

/**
 * Hand a project to a different judge. A recused assignment stays as history (so the pair is
 * never re-assigned); an untouched one is replaced. A submitted review can't be reassigned.
 */
export const ReassignBody = z.object({ judgeId: z.uuid() });

assignmentsRouter.post("/assignments/:assignmentId/reassign", async (req, res) => {
  const event = await staffEvent(req);
  requireClosed(event);
  const a = await assignmentInEvent(event.id, (req.params as { assignmentId: string }).assignmentId);
  const { judgeId } = ReassignBody.parse(req.body);
  if (a.status === "submitted" || a.review?.status === "submitted") throw new HttpError(409, "review_submitted", "A submitted review can't be reassigned.");
  await assertAssignable(event.id, judgeId, a.projectId);

  const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    if (a.status !== "recused") await tx.assignment.delete({ where: { id: a.id } });
    const n = await tx.assignment.create({ data: { eventId: event.id, judgeId, projectId: a.projectId } });
    await appendAudit(tx, {
      ...fromRequest(req), eventId: event.id, action: "assignment.reassigned", entityType: "Assignment", entityId: n.id,
      before: { assignmentId: a.id, judgeId: a.judgeId, status: a.status }, after: { judgeId, projectId: a.projectId },
    });
    return n;
  });
  res.status(201).json({ assignment: created });
});

assignmentsRouter.get("/assignment-batches", async (req, res) => {
  const event = await staffEvent(req);
  const batches = await prisma.assignmentBatch.findMany({
    where: { eventId: event.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, algorithm: true, params: true, seed: true, createdAt: true, createdBy: { select: { name: true } }, _count: { select: { assignments: true } } },
  });
  res.json({ batches: batches.map(({ _count, ...b }) => ({ ...b, assignments: _count.assignments })) });
});
