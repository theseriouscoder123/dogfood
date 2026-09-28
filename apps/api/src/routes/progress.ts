// The organizer's live view of judging. Mounted at /api/events/:slug.
//
//   GET  /progress                              totals, per judge, per track, projects at risk, timeline
//   POST /progress/remind                       email judges who still owe reviews (with a cooldown)
//   POST /judges/:judgeId/redistribute          preview (default) or commit: hand a judge's untouched
//                                               assignments to other judges with the assignment engine
//
// Redistribution follows the same "what you previewed is what you get" rule as auto-assign:
// the commit recomputes the plan and refuses if its inputs changed since the preview.
import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { accessFor, decideOrganize, enforce, judgingWindow } from "../policy";
import { appendAudit, fromRequest } from "../audit";
import { eventBySlug } from "../lib/events";
import { HttpError, notFound } from "../lib/http";
import { canonicalJson, sha256 } from "../lib/crypto";
import { absoluteUrl, sendMail } from "../lib/mail";
import { planAssignments, type AssignInput } from "../judging/assign";
import { assessJudge, cumulativeSeries, elapsedFraction, median } from "../judging/progress";
import { loadAssignInput } from "./assignments";

export const progressRouter = Router({ mergeParams: true });

const REMIND_COOLDOWN_MS = 6 * 3_600_000;
const DEFAULT_TARGET = 3;

async function staffEvent(req: Request) {
  const event = await eventBySlug((req.params as { slug?: string }).slug);
  enforce(decideOrganize(await accessFor(req.actor, event.id)));
  return event;
}

/** Reviews each project should get: whatever the organizer last auto-assigned with, else 3. */
export async function reviewTarget(eventId: string): Promise<number> {
  const batch = await prisma.assignmentBatch.findFirst({
    where: { eventId, algorithm: { startsWith: "balanced-greedy" } },
    orderBy: { createdAt: "desc" },
    select: { params: true },
  });
  const k = (batch?.params as { reviewsPerProject?: unknown } | null)?.reviewsPerProject;
  return typeof k === "number" && k > 0 ? k : DEFAULT_TARGET;
}

/** Evenly spaced cumulative counts, blank in the future, plus an exact point for "now". */
function timelinePoints(times: Date[], start: Date, end: Date, now: Date): Array<{ t: string; n: number | null }> {
  const points: Array<{ t: string; n: number | null }> = cumulativeSeries(times, start, end, 40).map((p) => (new Date(p.t) > now ? { t: p.t, n: null } : p));
  if (now > start && now < end) {
    const i = points.findIndex((p) => new Date(p.t) > now);
    points.splice(i, 0, { t: now.toISOString(), n: times.filter((d) => d <= now).length });
  }
  return points;
}

progressRouter.get("/progress", async (req, res) => {
  const event = await staffEvent(req);
  const now = new Date();
  const [roles, judgeTracks, tracks, projects, assignments, reminders, target] = await Promise.all([
    prisma.eventRole.findMany({ where: { eventId: event.id, role: "judge" }, select: { externalId: true, user: { select: { id: true, name: true, email: true } } } }),
    prisma.judgeTrack.findMany({ where: { eventId: event.id }, select: { userId: true, trackId: true } }),
    prisma.track.findMany({ where: { eventId: event.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.project.findMany({
      where: { eventId: event.id, status: "submitted", duplicateOfId: null },
      orderBy: { title: "asc" },
      select: { id: true, title: true, externalId: true, trackId: true, team: { select: { name: true } } },
    }),
    prisma.assignment.findMany({
      where: { eventId: event.id },
      select: { id: true, judgeId: true, projectId: true, status: true, openedAt: true, review: { select: { status: true, updatedAt: true, submittedAt: true } } },
    }),
    prisma.auditLog.findMany({
      where: { eventId: event.id, action: "judge.reminded", createdAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } },
      orderBy: { createdAt: "desc" },
      select: { entityId: true, createdAt: true },
    }),
    reviewTarget(event.id),
  ]);

  const window = judgingWindow(event, now);
  const opensAt = event.judgingOpensAt ?? event.submissionsCloseAt;
  const elapsed = window === "open" ? elapsedFraction(opensAt, event.judgingClosesAt, now) : window === "closed" ? 1 : 0;
  const trackName = new Map(tracks.map((t) => [t.id, t.name]));
  const lastReminder = new Map<string, Date>();
  for (const r of reminders) if (r.entityId && !lastReminder.has(r.entityId)) lastReminder.set(r.entityId, r.createdAt);

  const judgeable = new Set(projects.map((p) => p.id));
  const live = assignments.filter((a) => judgeable.has(a.projectId));
  const byJudge = new Map<string, typeof live>();
  const byProject = new Map<string, typeof live>();
  for (const a of live) {
    byJudge.set(a.judgeId, [...(byJudge.get(a.judgeId) ?? []), a]);
    byProject.set(a.projectId, [...(byProject.get(a.projectId) ?? []), a]);
  }

  const judges = roles
    .map(({ user, externalId }) => {
      const list = byJudge.get(user.id) ?? [];
      const n = (s: string) => list.filter((a) => a.status === s).length;
      const active = list.length - n("recused");
      const submitted = n("submitted");
      const started = list.some((a) => a.openedAt !== null || a.review !== null);
      const activity = list.flatMap((a) => [a.openedAt, a.review?.updatedAt].filter((d): d is Date => !!d)).map((d) => d.getTime());
      const minutes = list
        .filter((a) => a.status === "submitted" && a.openedAt && a.review?.submittedAt)
        .map((a) => (a.review!.submittedAt!.getTime() - a.openedAt!.getTime()) / 60_000)
        .filter((m) => m >= 0);
      return {
        id: user.id,
        externalId,
        name: user.name,
        email: user.email,
        tracks: judgeTracks.filter((t) => t.userId === user.id).map((t) => trackName.get(t.trackId) ?? "?").sort(),
        active,
        submitted,
        inProgress: n("in_progress"),
        notStarted: n("assigned"),
        recused: n("recused"),
        lastActivityAt: activity.length ? new Date(Math.max(...activity)) : null,
        medianMinutes: median(minutes),
        lastRemindedAt: lastReminder.get(user.id) ?? null,
        ...assessJudge({ active, submitted, started }, window, elapsed),
      };
    })
    .sort((a, b) => Number(b.straggler) - Number(a.straggler) || a.submitted / (a.active || 1) - b.submitted / (b.active || 1) || a.name.localeCompare(b.name));
  const straggler = new Map(judges.map((j) => [j.id, j]));

  const projectRows = projects.map((p) => {
    const list = (byProject.get(p.id) ?? []).filter((a) => a.status !== "recused");
    const submitted = list.filter((a) => a.status === "submitted").length;
    const pending = list.filter((a) => a.status !== "submitted");
    const reasons: string[] = [];
    if (list.length < target) reasons.push(list.length === 0 ? "no judges assigned" : `only ${list.length} of ${target} reviewers assigned`);
    if (pending.some((a) => straggler.get(a.judgeId)?.straggler)) reasons.push("waiting on a judge who is behind");
    return {
      id: p.id, title: p.title, externalId: p.externalId, team: p.team.name, track: p.trackId ? trackName.get(p.trackId) ?? null : null, trackId: p.trackId,
      assigned: list.length, submitted, reasons,
      pending: pending.map((a) => ({ assignmentId: a.id, judgeId: a.judgeId, judge: straggler.get(a.judgeId)?.name ?? "?", status: a.status, straggler: !!straggler.get(a.judgeId)?.straggler })),
    };
  });

  const trackRows = [...tracks, ...(projects.some((p) => !p.trackId) ? [{ id: null, name: "No track" }] : [])]
    .map((t) => {
      const ps = projectRows.filter((p) => p.trackId === t.id);
      return {
        id: t.id, name: t.name, projects: ps.length,
        assigned: ps.reduce((s, p) => s + p.assigned, 0),
        submitted: ps.reduce((s, p) => s + p.submitted, 0),
        complete: ps.filter((p) => p.submitted >= target).length,
      };
    })
    .filter((t) => t.projects > 0);

  const submittedTimes = live.filter((a) => a.status === "submitted" && a.review?.submittedAt).map((a) => a.review!.submittedAt!);
  const earliest = submittedTimes.length ? new Date(Math.min(...submittedTimes.map((d) => d.getTime()))) : null;
  const latest = submittedTimes.length ? new Date(Math.max(...submittedTimes.map((d) => d.getTime()))) : null;
  const axisStart = earliest && earliest < opensAt ? earliest : opensAt;
  const axisEnd =
    window === "open"
      ? event.judgingClosesAt ?? now
      : new Date(Math.max(event.judgingClosesAt?.getTime() ?? 0, latest?.getTime() ?? 0, window === "not_open" ? opensAt.getTime() + 86_400_000 : 0) || now.getTime());

  const active = live.filter((a) => a.status !== "recused");
  const count = (s: string) => live.filter((a) => a.status === s).length;
  res.json({
    generatedAt: now,
    judgingWindow: window,
    window: { opensAt, closesAt: event.judgingClosesAt, elapsed },
    target,
    totals: {
      reviews: active.length,
      submitted: count("submitted"),
      inProgress: count("in_progress"),
      notStarted: count("assigned"),
      recused: count("recused"),
      projects: projects.length,
      projectsComplete: projectRows.filter((p) => p.submitted >= target).length,
      projectsUnreviewed: projectRows.filter((p) => p.submitted === 0).length,
      judges: judges.length,
      judgesDone: judges.filter((j) => j.pace === "done").length,
      stragglers: judges.filter((j) => j.straggler).length,
    },
    timeline: {
      start: axisStart,
      end: axisEnd,
      points: timelinePoints(submittedTimes, axisStart, axisEnd, now),
    },
    judges,
    tracks: trackRows,
    attention: projectRows.filter((p) => p.reasons.length > 0 && p.submitted < target),
  });
});

export const RemindBody = z.object({ judgeIds: z.array(z.uuid()).min(1).max(500) });

progressRouter.post("/progress/remind", async (req, res) => {
  const event = await staffEvent(req);
  if (judgingWindow(event) === "closed") throw new HttpError(409, "judging_closed", "Judging has closed; there is nothing left to remind judges about.");
  const { judgeIds } = RemindBody.parse(req.body);
  const unique = [...new Set(judgeIds)];
  const since = new Date(Date.now() - REMIND_COOLDOWN_MS);

  const [roles, assignments, recent] = await Promise.all([
    prisma.eventRole.findMany({ where: { eventId: event.id, role: "judge", userId: { in: unique } }, select: { user: { select: { id: true, name: true, email: true } } } }),
    prisma.assignment.findMany({ where: { eventId: event.id, judgeId: { in: unique }, status: { in: ["assigned", "in_progress"] } }, select: { judgeId: true } }),
    prisma.auditLog.findMany({ where: { eventId: event.id, action: "judge.reminded", entityId: { in: unique }, createdAt: { gte: since } }, select: { entityId: true } }),
  ]);
  const judgeOf = new Map(roles.map((r) => [r.user.id, r.user]));
  const owed = new Map<string, number>();
  for (const a of assignments) owed.set(a.judgeId, (owed.get(a.judgeId) ?? 0) + 1);
  const recentlyReminded = new Set(recent.map((r) => r.entityId));

  const sent: string[] = [];
  const skipped: Array<{ judgeId: string; reason: string }> = [];
  for (const id of unique) {
    const judge = judgeOf.get(id);
    if (!judge) skipped.push({ judgeId: id, reason: "not a judge of this event" });
    else if (!owed.get(id)) skipped.push({ judgeId: id, reason: "no reviews outstanding" });
    else if (recentlyReminded.has(id)) skipped.push({ judgeId: id, reason: "already reminded in the last 6 hours" });
    else {
      const n = owed.get(id)!;
      const closes = event.judgingClosesAt ? ` Judging closes ${event.judgingClosesAt.toUTCString().replace(":00 GMT", " UTC")}.` : "";
      await sendMail({
        to: judge.email,
        subject: `${n} review${n === 1 ? "" : "s"} waiting for you in ${event.name}`,
        heading: `Your reviews for ${event.name}`,
        body: [`Hi ${judge.name.split(" ")[0]}, you have ${n} project${n === 1 ? "" : "s"} left to review.${closes}`, "Drafts save automatically, so you can score a few now and finish later."],
        action: { label: "Open my judging queue", url: absoluteUrl(`/events/${event.slug}/judging`) },
      });
      await prisma.$transaction((tx) =>
        appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "judge.reminded", entityType: "User", entityId: id, after: { outstanding: n } }),
      );
      sent.push(id);
    }
  }
  res.json({ sent, skipped });
});

// ── redistribution ──────────────────────────────────────────────────────────

export const RedistributeBody = z.object({
  commit: z.boolean().default(false),
  inputHash: z.string().length(64).optional(),
  seed: z.number().int().min(0).max(2 ** 31 - 1).default(1),
});

/** A judge's untouched work (never saved a draft) and the plan that moves it to other judges. */
async function redistribution(db: Parameters<typeof loadAssignInput>[0], eventId: string, judgeId: string, seed: number, target: number) {
  const [snapshot, released] = await Promise.all([
    loadAssignInput(db, eventId),
    db.assignment.findMany({ where: { eventId, judgeId, status: "assigned" }, orderBy: { id: "asc" }, select: { id: true, projectId: true } }),
  ]);
  const releasedProjects = new Set(released.map((a) => a.projectId));
  const input: AssignInput = {
    ...snapshot,
    judges: snapshot.judges.filter((j) => j.id !== judgeId),
    existing: snapshot.existing.filter((e) => !(e.judgeId === judgeId && releasedProjects.has(e.projectId))),
    onlyProjects: [...releasedProjects].filter((id) => snapshot.projects.some((p) => p.id === id)).sort(),
    reviewsPerProject: target,
    maxPerJudge: null,
    seed,
  };
  const inputHash = sha256(canonicalJson({ input, judgeId, released: released.map((a) => a.id) }));
  return { released, input, inputHash, plan: planAssignments(input) };
}

progressRouter.post("/judges/:judgeId/redistribute", async (req, res) => {
  const event = await staffEvent(req);
  if (judgingWindow(event) === "closed") throw new HttpError(409, "judging_closed", "Judging has closed.");
  const judgeId = (req.params as { judgeId: string }).judgeId;
  const judge = z.uuid().safeParse(judgeId).success
    ? await prisma.eventRole.findFirst({ where: { eventId: event.id, userId: judgeId, role: "judge" }, select: { user: { select: { id: true, name: true } } } })
    : null;
  if (!judge) throw notFound("Judge");
  const body = RedistributeBody.parse(req.body ?? {});
  const target = await reviewTarget(event.id);

  if (!body.commit) {
    const r = await redistribution(prisma, event.id, judgeId, body.seed, target);
    if (r.released.length === 0) throw new HttpError(409, "nothing_to_release", `${judge.user.name} has started every review assigned to them; there is nothing untouched to move.`);
    const [users, projects] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: r.plan.assignments.map((a) => a.judgeId) } }, select: { id: true, name: true } }),
      prisma.project.findMany({ where: { id: { in: r.released.map((a) => a.projectId) } }, select: { id: true, title: true } }),
    ]);
    const name = new Map(users.map((u) => [u.id, u.name]));
    const title = new Map(projects.map((p) => [p.id, p.title]));
    res.json({
      judge: judge.user,
      inputHash: r.inputHash,
      seed: body.seed,
      target,
      released: r.released.map((a) => ({ assignmentId: a.id, projectId: a.projectId, title: title.get(a.projectId) ?? "?" })),
      moves: r.plan.assignments
        .map((a) => ({ projectId: a.projectId, title: title.get(a.projectId) ?? "?", judgeId: a.judgeId, judge: name.get(a.judgeId) ?? "?", loadAfter: r.plan.loadAfter[a.judgeId] ?? 0 }))
        .sort((a, b) => a.title.localeCompare(b.title)),
      unplaced: r.plan.shortfalls.map((s) => ({ projectId: s.projectId, title: title.get(s.projectId) ?? "?", have: s.have, need: s.need, reason: s.reason })),
    });
    return;
  }

  if (!body.inputHash) throw new HttpError(400, "missing_input_hash", "Preview the redistribution first.");
  const result = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"assign:" + event.id}))`;
      const r = await redistribution(tx, event.id, judgeId, body.seed, target);
      if (r.inputHash !== body.inputHash)
        throw new HttpError(409, "stale_preview", "Something changed since you previewed (a review was started, or assignments changed). Preview again.");
      if (r.released.length === 0) throw new HttpError(409, "nothing_to_release", "There is nothing untouched to move.");

      await tx.assignment.deleteMany({ where: { id: { in: r.released.map((a) => a.id) }, status: "assigned" } });
      const batch = await tx.assignmentBatch.create({
        data: {
          eventId: event.id,
          name: `Redistributed from ${judge.user.name}`,
          algorithm: "redistribute-v1",
          params: { fromJudgeId: judgeId, reviewsPerProject: target, inputHash: r.inputHash },
          seed: body.seed,
          createdById: req.actor!.id,
        },
      });
      if (r.plan.assignments.length) await tx.assignment.createMany({ data: r.plan.assignments.map((a) => ({ ...a, eventId: event.id, batchId: batch.id })) });
      await appendAudit(tx, {
        ...fromRequest(req), eventId: event.id, action: "assignments.redistributed", entityType: "User", entityId: judgeId,
        before: { released: r.released.map((a) => ({ assignmentId: a.id, projectId: a.projectId })) },
        after: { batchId: batch.id, created: r.plan.assignments, unplaced: r.plan.shortfalls.map((s) => s.projectId) },
      });
      return { batchId: batch.id, released: r.released.length, created: r.plan.assignments.length, unplaced: r.plan.shortfalls.length };
    },
    { timeout: 60_000 },
  );
  res.status(201).json(result);
});
