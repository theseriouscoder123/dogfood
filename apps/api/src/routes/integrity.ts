// Review integrity checks for organizers. Mounted at /api/events/:slug.
//
//   GET  /integrity           flags recomputed from the current reviews, with any decisions taken
//   POST /integrity/resolve   dismiss, confirm or reopen one flag (audited)
//
// Flags are advice, not verdicts: nothing here changes a score or a ranking. An organizer who
// agrees with a flag acts through the normal tools (exclude the judge from a results run,
// reassign, talk to the judge), and records that decision here.
import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { accessFor, decideOrganize, enforce } from "../policy";
import { appendAudit, fromRequest } from "../audit";
import { eventBySlug } from "../lib/events";
import { HttpError } from "../lib/http";
import { compositeScore } from "../judging/composite";
import { normalize, DEFAULT_PARAMS } from "../judging/normalize";
import { integrityFlags, reliability, type IntegrityReview } from "../judging/integrity";
import { loadResultInputs } from "../judging/results";

export const integrityRouter = Router({ mergeParams: true });

async function staffEvent(req: Request) {
  const event = await eventBySlug((req.params as { slug?: string }).slug);
  enforce(decideOrganize(await accessFor(req.actor, event.id)));
  return event;
}

/** Everything the checks look at, for the event's judgeable projects. */
export async function computeIntegrity(eventId: string) {
  const [inputs, details] = await Promise.all([
    loadResultInputs(prisma, eventId),
    prisma.review.findMany({
      where: { eventId, status: "submitted" },
      select: { id: true, comment: true, submittedAt: true, assignment: { select: { openedAt: true } } },
    }),
  ]);
  const detail = new Map(details.map((d) => [d.id, d]));
  const judgeable = new Set(inputs.projects.filter((p) => !p.duplicateOfId).map((p) => p.id));
  const reviews: IntegrityReview[] = [];
  for (const r of inputs.reviews) {
    const composite = compositeScore(r.scores, inputs.criteria);
    if (composite === null || !judgeable.has(r.projectId)) continue;
    const d = detail.get(r.id);
    const opened = d?.assignment.openedAt;
    const seconds = opened && d?.submittedAt ? (d.submittedAt.getTime() - opened.getTime()) / 1000 : null;
    reviews.push({
      reviewId: r.id,
      judgeId: r.judgeId,
      projectId: r.projectId,
      values: inputs.criteria.map((c) => r.scores.get(c.id)).filter((v): v is number => v !== undefined),
      composite,
      comment: d?.comment ?? "",
      secondsToSubmit: seconds !== null && seconds >= 0 ? seconds : null,
    });
  }
  const model = normalize(
    reviews.map((r) => ({ judgeId: r.judgeId, projectId: r.projectId, score: r.composite })),
    DEFAULT_PARAMS,
  );
  return { inputs, reviews, flags: integrityFlags(reviews, model), reliability: reliability(reviews) };
}

integrityRouter.get("/integrity", async (req, res) => {
  const event = await staffEvent(req);
  const [{ inputs, reviews, flags, reliability: rel }, resolutions] = await Promise.all([
    computeIntegrity(event.id),
    prisma.integrityResolution.findMany({ where: { eventId: event.id }, include: { resolvedBy: { select: { name: true } } } }),
  ]);
  const judge = new Map(inputs.judges.map((j) => [j.id, j]));
  const project = new Map(inputs.projects.map((p) => [p.id, p]));
  const decided = new Map(resolutions.map((r) => [r.flagKey, r]));
  const byType: Record<string, number> = {};
  for (const f of flags) byType[f.type] = (byType[f.type] ?? 0) + 1;

  res.json({
    summary: {
      reviewsChecked: reviews.length,
      judges: new Set(reviews.map((r) => r.judgeId)).size,
      timedReviews: reviews.filter((r) => r.secondsToSubmit !== null).length,
      commentedReviews: reviews.filter((r) => r.comment.trim()).length,
      flags: flags.length,
      open: flags.filter((f) => !decided.has(f.key)).length,
      byType,
    },
    reliability: rel,
    flags: flags.map((f) => {
      const d = decided.get(f.key);
      const j = judge.get(f.judgeId);
      const p = f.projectId ? project.get(f.projectId) : null;
      return {
        ...f,
        judge: { id: f.judgeId, name: j?.name ?? "Former judge", externalId: j?.externalId ?? null },
        project: p ? { id: p.id, title: p.title, externalId: p.externalId } : null,
        resolution: d ? { status: d.status, note: d.note, by: d.resolvedBy?.name ?? null, at: d.resolvedAt } : null,
      };
    }),
  });
});

const ResolveBody = z.object({
  flagKey: z.string().min(1).max(300),
  status: z.enum(["dismissed", "confirmed", "open"]),
  note: z.string().trim().max(1000).default(""),
});

integrityRouter.post("/integrity/resolve", async (req, res) => {
  const event = await staffEvent(req);
  const body = ResolveBody.parse(req.body);

  if (body.status === "open") {
    const existing = await prisma.integrityResolution.findUnique({ where: { eventId_flagKey: { eventId: event.id, flagKey: body.flagKey } } });
    if (!existing) throw new HttpError(404, "not_resolved", "That flag has no decision to undo.");
    await prisma.$transaction(async (tx) => {
      await tx.integrityResolution.delete({ where: { eventId_flagKey: { eventId: event.id, flagKey: body.flagKey } } });
      await appendAudit(tx, {
        ...fromRequest(req), eventId: event.id, action: "integrity.flag_reopened", entityType: "IntegrityFlag", entityId: body.flagKey,
        before: { status: existing.status, note: existing.note },
      });
    });
    res.json({ flagKey: body.flagKey, resolution: null });
    return;
  }

  if (body.status === "dismissed" && body.note.length < 3) throw new HttpError(400, "note_required", "Say why this flag is fine, so the next person reading it knows.");
  const { flags } = await computeIntegrity(event.id);
  const flag = flags.find((f) => f.key === body.flagKey);
  if (!flag) throw new HttpError(404, "flag_not_found", "That flag no longer applies to the current reviews.");

  const saved = await prisma.$transaction(async (tx) => {
    const r = await tx.integrityResolution.upsert({
      where: { eventId_flagKey: { eventId: event.id, flagKey: body.flagKey } },
      create: { eventId: event.id, flagKey: body.flagKey, status: body.status, note: body.note, resolvedById: req.actor!.id },
      update: { status: body.status, note: body.note, resolvedById: req.actor!.id, resolvedAt: new Date() },
    });
    await appendAudit(tx, {
      ...fromRequest(req), eventId: event.id, action: "integrity.flag_resolved", entityType: "IntegrityFlag", entityId: body.flagKey,
      after: { status: body.status, note: body.note, type: flag.type, judgeId: flag.judgeId, projectId: flag.projectId, evidence: flag.evidence },
    });
    return r;
  });
  res.json({ flagKey: body.flagKey, resolution: { status: saved.status, note: saved.note, at: saved.resolvedAt } });
});
