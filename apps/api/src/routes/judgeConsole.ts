// The judge's side of judging. Mounted at /api/events/:slug/judging.
//
// Isolation is structural: every query below filters on judgeId = the caller. An assignment
// that isn't yours is indistinguishable from one that doesn't exist (404), so a judge can't
// probe for other judges' work. Judges never receive other reviews, aggregates or rankings.
import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { accessFor, decideScore, enforce, judgingWindow } from "../policy";
import { appendAudit, fromRequest } from "../audit";
import { eventBySlug } from "../lib/events";
import { HttpError, notFound, unauthenticated } from "../lib/http";

export const judgeConsoleRouter = Router({ mergeParams: true });

async function judgeContext(req: Request) {
  const event = await eventBySlug((req.params as { slug?: string }).slug);
  if (!req.actor) throw unauthenticated();
  const access = await accessFor(req.actor, event.id);
  if (!access.roles.has("judge")) throw new HttpError(403, "not_a_judge", "You're not a judge of this event.");
  return { event, access, judgeId: req.actor.id };
}

async function criteriaOf(eventId: string) {
  const rows = await prisma.criterion.findMany({ where: { eventId }, orderBy: [{ position: "asc" }, { label: "asc" }] });
  return rows.map((c) => ({ id: c.id, key: c.key, label: c.label, description: c.description, weight: Number(c.weight), minScore: c.minScore, maxScore: c.maxScore }));
}

/** The one place an assignment is loaded for a judge. Not yours → 404. */
async function myAssignment(eventId: string, judgeId: string, assignmentId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(assignmentId)) throw notFound("Assignment");
  const a = await prisma.assignment.findFirst({
    where: { id: assignmentId, eventId, judgeId },
    include: { review: { include: { scores: true } } },
  });
  if (!a) throw notFound("Assignment");
  return a;
}

/** The judge's queue: their assignments only, with progress and the rubric. */
judgeConsoleRouter.get("/", async (req, res) => {
  const { event, judgeId } = await judgeContext(req);
  const [assignments, criteria] = await Promise.all([
    prisma.assignment.findMany({
      where: { eventId: event.id, judgeId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, status: true, recusalReason: true, openedAt: true,
        review: { select: { status: true, updatedAt: true, submittedAt: true } },
        project: { select: { id: true, title: true, tagline: true, thumbnailUrl: true, track: { select: { name: true } }, team: { select: { name: true } } } },
      },
    }),
    criteriaOf(event.id),
  ]);
  const count = (s: string) => assignments.filter((a) => a.status === s).length;
  res.json({
    event: { slug: event.slug, name: event.name, judgingOpensAt: event.judgingOpensAt ?? event.submissionsCloseAt, judgingClosesAt: event.judgingClosesAt },
    judgingWindow: judgingWindow(event),
    criteria,
    progress: { total: assignments.length - count("recused"), submitted: count("submitted"), inProgress: count("in_progress"), todo: count("assigned"), recused: count("recused") },
    assignments: assignments.map((a) => ({
      id: a.id, status: a.status, recusalReason: a.recusalReason, lastSavedAt: a.review?.updatedAt ?? null, submittedAt: a.review?.submittedAt ?? null,
      project: { ...a.project, track: a.project.track?.name ?? null, team: a.project.team.name },
    })),
  });
});

/** Everything needed to score one project. Records when the judge first opened it. */
judgeConsoleRouter.get("/:assignmentId", async (req, res) => {
  const { event, judgeId } = await judgeContext(req);
  const a = await myAssignment(event.id, judgeId, (req.params as { assignmentId: string }).assignmentId);
  if (!a.openedAt && judgingWindow(event) === "open") {
    await prisma.assignment.update({ where: { id: a.id }, data: { openedAt: new Date() } });
  }
  const [project, criteria, queue] = await Promise.all([
    prisma.project.findUniqueOrThrow({
      where: { id: a.projectId },
      select: {
        id: true, title: true, tagline: true, description: true, repoUrl: true, demoUrl: true, videoUrl: true, thumbnailUrl: true, techTags: true,
        track: { select: { name: true } },
        team: { select: { name: true, members: { select: { user: { select: { name: true } } } } } },
        // Judges see public answers only; private answers are for organizers.
        answers: { where: { question: { isPublic: true } }, select: { value: true, question: { select: { label: true, type: true, position: true } } } },
      },
    }),
    criteriaOf(event.id),
    prisma.assignment.findMany({ where: { eventId: event.id, judgeId }, orderBy: { createdAt: "asc" }, select: { id: true, status: true } }),
  ]);
  const i = queue.findIndex((q) => q.id === a.id);
  res.json({
    assignment: { id: a.id, status: a.status, recusalReason: a.recusalReason },
    review: a.review && {
      status: a.review.status, comment: a.review.comment, submittedAt: a.review.submittedAt, updatedAt: a.review.updatedAt,
      scores: Object.fromEntries(a.review.scores.map((s) => [s.criterionId, s.value])),
    },
    project: {
      ...project,
      track: project.track?.name ?? null,
      team: { name: project.team.name, members: project.team.members.map((m) => m.user.name) },
      answers: project.answers.sort((x, y) => x.question.position - y.question.position).map((x) => ({ label: x.question.label, type: x.question.type, value: x.value })),
    },
    criteria,
    judgingWindow: judgingWindow(event),
    nav: {
      position: i + 1,
      total: queue.length,
      previousId: queue[i - 1]?.id ?? null,
      nextId: queue[i + 1]?.id ?? null,
      nextUnscoredId: [...queue.slice(i + 1), ...queue.slice(0, i)].find((q) => q.status === "assigned" || q.status === "in_progress")?.id ?? null,
    },
  });
});

export const ReviewBody = z.object({
  scores: z.record(z.uuid(), z.number().int()).default({}),
  comment: z.string().max(5000).default(""),
});

type Criteria = Awaited<ReturnType<typeof criteriaOf>>;

function validateScores(scores: Record<string, number>, criteria: Criteria) {
  for (const [criterionId, value] of Object.entries(scores)) {
    const c = criteria.find((x) => x.id === criterionId);
    if (!c) throw new HttpError(400, "invalid_criterion", "That criterion isn't part of this event's rubric.");
    if (value < c.minScore || value > c.maxScore) throw new HttpError(400, "score_out_of_range", `${c.label} must be between ${c.minScore} and ${c.maxScore}.`);
  }
}

const missingCriteria = (scores: Record<string, number>, criteria: Criteria) => criteria.filter((c) => scores[c.id] === undefined).map((c) => c.label);

/**
 * Save a draft (autosave), or update a submitted review. Drafts may be partial. A submitted
 * review stays submitted and must stay complete; every revision is audited with before/after.
 */
judgeConsoleRouter.put("/:assignmentId/review", async (req, res) => {
  const { event, access, judgeId } = await judgeContext(req);
  const a = await myAssignment(event.id, judgeId, (req.params as { assignmentId: string }).assignmentId);
  enforce(decideScore(access, judgingWindow(event), a));
  const body = ReviewBody.parse(req.body);
  const criteria = await criteriaOf(event.id);
  validateScores(body.scores, criteria);

  const wasSubmitted = a.review?.status === "submitted";
  const merged = { ...Object.fromEntries((a.review?.scores ?? []).map((s) => [s.criterionId, s.value])), ...body.scores };
  if (wasSubmitted) {
    const missing = missingCriteria(merged, criteria);
    if (missing.length) throw new HttpError(422, "incomplete_review", `A submitted review needs every score (missing: ${missing.join(", ")}).`);
  }

  const review = await prisma.$transaction(async (tx) => {
    const r = a.review
      ? await tx.review.update({ where: { id: a.review.id }, data: { comment: body.comment } })
      : await tx.review.create({ data: { assignmentId: a.id, eventId: event.id, judgeId, projectId: a.projectId, comment: body.comment } });
    for (const [criterionId, value] of Object.entries(body.scores)) {
      await tx.reviewScore.upsert({
        where: { reviewId_criterionId: { reviewId: r.id, criterionId } },
        update: { value },
        create: { reviewId: r.id, criterionId, value },
      });
    }
    if (a.status === "assigned") await tx.assignment.update({ where: { id: a.id }, data: { status: "in_progress" } });
    if (wasSubmitted) {
      const before = Object.fromEntries((a.review?.scores ?? []).map((s) => [s.criterionId, s.value]));
      const changed = Object.keys(merged).filter((k) => before[k] !== merged[k]);
      if (changed.length || a.review!.comment !== body.comment) {
        await appendAudit(tx, {
          ...fromRequest(req), eventId: event.id, action: "review.revised", entityType: "Review", entityId: r.id,
          before: { scores: before, comment: a.review!.comment }, after: { scores: merged, comment: body.comment },
        });
      }
    }
    return r;
  });
  res.json({ review: { status: review.status, updatedAt: review.updatedAt, scores: merged, comment: body.comment } });
});

/** Submit: every criterion must have a score. */
judgeConsoleRouter.post("/:assignmentId/submit", async (req, res) => {
  const { event, access, judgeId } = await judgeContext(req);
  const a = await myAssignment(event.id, judgeId, (req.params as { assignmentId: string }).assignmentId);
  enforce(decideScore(access, judgingWindow(event), a));
  if (a.review?.status === "submitted") throw new HttpError(409, "already_submitted", "This review is already submitted. You can still edit it until judging closes.");
  const criteria = await criteriaOf(event.id);
  if (criteria.length === 0) throw new HttpError(409, "no_rubric", "The organizers haven't set up the rubric yet.");
  const scores = Object.fromEntries((a.review?.scores ?? []).map((s) => [s.criterionId, s.value]));
  const missing = missingCriteria(scores, criteria);
  if (missing.length) throw new HttpError(422, "incomplete_review", `Score every criterion before submitting (missing: ${missing.join(", ")}).`, { missing });

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.review.update({ where: { id: a.review!.id }, data: { status: "submitted", submittedAt: now } });
    await tx.assignment.update({ where: { id: a.id }, data: { status: "submitted" } });
    await appendAudit(tx, {
      ...fromRequest(req), eventId: event.id, action: "review.submit", entityType: "Review", entityId: a.review!.id,
      after: { projectId: a.projectId, scores, comment: a.review!.comment, secondsSinceOpened: a.openedAt ? Math.round((now.getTime() - a.openedAt.getTime()) / 1000) : null },
    });
  });
  res.json({ review: { status: "submitted", submittedAt: now } });
});

/**
 * Step away from a project. Optionally declare a conflict of interest with its team, which
 * also keeps the assignment engine from ever sending you that team again. Recusal is final
 * for the pair; a submitted review can't be recused (ask an organizer).
 */
export const RecuseBody = z.object({ reason: z.string().trim().min(3).max(500), declareConflict: z.boolean().default(false) });

judgeConsoleRouter.post("/:assignmentId/recuse", async (req, res) => {
  const { event, judgeId } = await judgeContext(req);
  const a = await myAssignment(event.id, judgeId, (req.params as { assignmentId: string }).assignmentId);
  const body = RecuseBody.parse(req.body);
  if (a.status === "recused") throw new HttpError(409, "recused", "You've already recused yourself from this project.");
  if (a.status === "submitted") throw new HttpError(409, "review_submitted", "You've submitted this review. Ask an organizer if you need to withdraw it.");
  if (judgingWindow(event) === "closed") enforce("judging_closed");

  const project = await prisma.project.findUniqueOrThrow({ where: { id: a.projectId }, select: { teamId: true } });
  await prisma.$transaction(async (tx) => {
    await tx.assignment.update({ where: { id: a.id }, data: { status: "recused", recusalReason: body.reason } });
    if (a.review) await tx.review.delete({ where: { id: a.review.id } }); // a draft only; submitted was refused above
    if (body.declareConflict) {
      await tx.conflictOfInterest.upsert({
        where: { eventId_judgeId_teamId: { eventId: event.id, judgeId, teamId: project.teamId } },
        update: { note: body.reason },
        create: { eventId: event.id, judgeId, teamId: project.teamId, source: "declared", note: body.reason },
      });
    }
    await appendAudit(tx, {
      ...fromRequest(req), eventId: event.id, action: "assignment.recused", entityType: "Assignment", entityId: a.id,
      after: { projectId: a.projectId, reason: body.reason, declaredConflict: body.declareConflict },
    });
  });
  res.json({ assignment: { id: a.id, status: "recused" } });
});
