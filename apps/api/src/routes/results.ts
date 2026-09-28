// Results: compute, snapshot, publish. Mounted at /api/events/:slug.
//
//   GET  /normalization                       workbench state: runs, which is published, defaults
//   POST /normalization/preview               compute with options, save nothing
//   POST /normalization/runs                  compute and save an immutable snapshot
//   GET  /normalization/runs/:runId           one snapshot, and whether the data has moved on
//   POST /normalization/runs/:runId/publish   make a snapshot the public result
//   POST /normalization/unpublish             hide results again
//   GET  /results                             public: the published ranking (404 until then)
//
// Rules: a run is never edited (DB trigger); a run can only be published after judging closes
// and only while it still matches the data (same input fingerprint); excluding a judge needs
// a written reason, stored in the run and the audit log.
import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { accessFor, decideOrganize, enforce, judgingWindow } from "../policy";
import { appendAudit, fromRequest } from "../audit";
import { eventBySlug } from "../lib/events";
import { HttpError, notFound } from "../lib/http";
import { DEFAULT_PARAMS } from "../judging/normalize";
import { computeResults, inputHash, loadResultInputs, METHOD, normalizeOptions, persistRun, type ComputedResults, type ResultInputs, type RunOptions } from "../judging/results";
import { reviewTarget } from "./progress";
import { computeIntegrity } from "./integrity";
import { buildProofReport } from "../judging/proof";
import { compositeScore } from "../judging/composite";

export const resultsRouter = Router({ mergeParams: true });

async function staffEvent(req: Request) {
  const event = await eventBySlug((req.params as { slug?: string }).slug);
  enforce(decideOrganize(await accessFor(req.actor, event.id)));
  return event;
}

export const OptionsBody = z.object({
  lambdaJudge: z.number().min(0).max(100).optional(),
  lambdaProject: z.number().min(0).max(100).optional(),
  minReviews: z.number().int().min(1).max(20).optional(),
  excludedJudges: z
    .array(z.object({ judgeId: z.uuid(), reason: z.string().trim().min(5, "Say why this judge is excluded (at least 5 characters).").max(500) }))
    .max(500)
    .default([]),
});

async function readOptions(req: Request, eventId: string, inputs: ResultInputs): Promise<RunOptions> {
  const body = OptionsBody.parse(req.body ?? {});
  const judgeIds = new Set(inputs.judges.map((j) => j.id));
  const unknown = body.excludedJudges.find((e) => !judgeIds.has(e.judgeId));
  if (unknown) throw new HttpError(400, "invalid_judge", "An excluded judge isn't a judge of this event.");
  if (new Set(body.excludedJudges.map((e) => e.judgeId)).size !== body.excludedJudges.length) throw new HttpError(400, "invalid_request", "A judge is excluded twice.");
  return normalizeOptions({ ...body, minReviews: body.minReviews ?? (await reviewTarget(eventId)) });
}

const storedOptions = (params: unknown): RunOptions => params as RunOptions;

/** The saved run, joined back to names and titles for display. */
async function runDetail(runId: string, eventId: string) {
  const run = await prisma.normalizationRun.findFirst({
    where: { id: runId, eventId },
    include: {
      createdBy: { select: { name: true } },
      results: {
        include: {
          project: { select: { id: true, externalId: true, title: true, tagline: true, thumbnailUrl: true, team: { select: { name: true } }, track: { select: { id: true, name: true } } } },
        },
      },
      judgeStats: true,
    },
  });
  if (!run) throw notFound("Run");
  const users = await prisma.eventRole.findMany({ where: { eventId, role: "judge", userId: { in: run.judgeStats.map((j) => j.judgeId) } }, select: { externalId: true, user: { select: { id: true, name: true } } } });
  const who = new Map(users.map((u) => [u.user.id, u]));
  const reasons = new Map(storedOptions(run.params).excludedJudges.map((e) => [e.judgeId, e.reason]));
  return {
    run,
    projects: run.results
      .map((r) => ({
        projectId: r.projectId, externalId: r.project.externalId, title: r.project.title, tagline: r.project.tagline, thumbnailUrl: r.project.thumbnailUrl,
        team: r.project.team.name, track: r.project.track,
        nReviews: r.nReviews, rawScore: r.rawScore, normalizedScore: r.normalizedScore, stdError: r.stdError,
        rank: r.rank, rawRank: r.rawRank, rankLow: r.rankLow, rankHigh: r.rankHigh, pTop: r.pTop, flags: r.flags,
      }))
      .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.title.localeCompare(b.title)),
    judges: run.judgeStats
      .map((j) => ({
        judgeId: j.judgeId, name: who.get(j.judgeId)?.user.name ?? "Former judge", externalId: who.get(j.judgeId)?.externalId ?? null,
        nReviews: j.nReviews, rawMean: j.rawMean, offset: j.offset, stdDev: j.stdDev, flags: j.flags, exclusionReason: reasons.get(j.judgeId) ?? null,
      }))
      .sort((a, b) => b.offset - a.offset || a.name.localeCompare(b.name)),
  };
}

resultsRouter.get("/normalization", async (req, res) => {
  const event = await staffEvent(req);
  const [inputs, runs, target] = await Promise.all([
    loadResultInputs(prisma, event.id),
    prisma.normalizationRun.findMany({ where: { eventId: event.id }, orderBy: { createdAt: "desc" }, include: { createdBy: { select: { name: true } } } }),
    reviewTarget(event.id),
  ]);
  res.json({
    judgingWindow: judgingWindow(event),
    publishedRunId: event.publishedRunId,
    reviewsSubmitted: inputs.reviews.length,
    defaults: { lambdaJudge: DEFAULT_PARAMS.lambdaJudge, lambdaProject: DEFAULT_PARAMS.lambdaProject, minReviews: target },
    judges: inputs.judges.sort((a, b) => a.name.localeCompare(b.name)),
    runs: runs.map((r) => ({
      id: r.id, method: r.method, createdAt: r.createdAt, createdBy: r.createdBy?.name ?? null, inputHash: r.inputHash,
      options: storedOptions(r.params), summary: r.summary, componentCount: r.componentCount,
      published: r.id === event.publishedRunId,
      stale: inputHash(inputs, storedOptions(r.params)) !== r.inputHash,
    })),
  });
});

/** Rank moves against the currently published run, so an organizer sees the impact of a change. */
async function compareToPublished(eventId: string, publishedRunId: string | null, computed: ComputedResults) {
  if (!publishedRunId) return null;
  const rows = await prisma.projectResult.findMany({ where: { runId: publishedRunId }, select: { projectId: true, rank: true } });
  const before = new Map(rows.map((r) => [r.projectId, r.rank]));
  return Object.fromEntries(computed.projects.map((p) => [p.projectId, before.get(p.projectId) ?? null]));
}

resultsRouter.post("/normalization/preview", async (req, res) => {
  const event = await staffEvent(req);
  const inputs = await loadResultInputs(prisma, event.id);
  const options = await readOptions(req, event.id, inputs);
  const computed = computeResults(inputs, options);
  res.json({ ...computed, options, method: METHOD, inputHash: inputHash(inputs, options), publishedRanks: await compareToPublished(event.id, event.publishedRunId, computed) });
});

resultsRouter.post("/normalization/runs", async (req, res) => {
  const event = await staffEvent(req);
  const run = await prisma.$transaction(
    async (tx) => {
      const inputs = await loadResultInputs(tx, event.id);
      if (inputs.reviews.length === 0) throw new HttpError(409, "no_reviews", "There are no submitted reviews to compute results from yet.");
      const options = await readOptions(req, event.id, inputs);
      const { run: created, computed, hash } = await persistRun(tx, event.id, options, req.actor!.id, inputs);
      await appendAudit(tx, {
        ...fromRequest(req), eventId: event.id, action: "results.run_created", entityType: "NormalizationRun", entityId: created.id,
        after: { method: METHOD, inputHash: hash, options, top: computed.projects.slice(0, 3).map((p) => p.externalId ?? p.projectId), rankAgreement: computed.summary.rankAgreement },
      });
      return created;
    },
    { timeout: 60_000 },
  );
  res.status(201).json({ run: { id: run.id, inputHash: run.inputHash } });
});

resultsRouter.get("/normalization/runs/:runId", async (req, res) => {
  const event = await staffEvent(req);
  const runId = (req.params as { runId: string }).runId;
  if (!z.uuid().safeParse(runId).success) throw notFound("Run");
  const detail = await runDetail(runId, event.id);
  const inputs = await loadResultInputs(prisma, event.id);
  const { run } = detail;
  res.json({
    run: { id: run.id, method: run.method, createdAt: run.createdAt, createdBy: run.createdBy?.name ?? null, inputHash: run.inputHash, weights: run.weights, published: run.id === event.publishedRunId, stale: inputHash(inputs, storedOptions(run.params)) !== run.inputHash },
    options: storedOptions(run.params),
    summary: run.summary,
    projects: detail.projects,
    judges: detail.judges,
  });
});

resultsRouter.post("/normalization/runs/:runId/publish", async (req, res) => {
  const event = await staffEvent(req);
  const runId = (req.params as { runId: string }).runId;
  if (!z.uuid().safeParse(runId).success) throw notFound("Run");
  if (judgingWindow(event) !== "closed")
    throw new HttpError(409, "judging_open", "Publish once judging has closed, so no review can change after the results are out.");
  await prisma.$transaction(async (tx) => {
    const run = await tx.normalizationRun.findFirst({ where: { id: runId, eventId: event.id } });
    if (!run) throw notFound("Run");
    const inputs = await loadResultInputs(tx, event.id);
    if (inputHash(inputs, storedOptions(run.params)) !== run.inputHash)
      throw new HttpError(409, "stale_run", "Reviews or the rubric changed after this run was computed. Compute a new run and publish that.");
    const top = await tx.projectResult.findMany({ where: { runId, rank: { not: null } }, orderBy: { rank: "asc" }, take: 3, select: { projectId: true, rank: true, normalizedScore: true } });
    await tx.event.update({ where: { id: event.id }, data: { publishedRunId: run.id } });
    await appendAudit(tx, {
      ...fromRequest(req), eventId: event.id, action: "results.published", entityType: "NormalizationRun", entityId: run.id,
      before: { publishedRunId: event.publishedRunId }, after: { publishedRunId: run.id, inputHash: run.inputHash, top },
    });
  });
  res.json({ publishedRunId: runId });
});

resultsRouter.post("/normalization/unpublish", async (req, res) => {
  const event = await staffEvent(req);
  if (!event.publishedRunId) throw new HttpError(409, "not_published", "Results aren't published.");
  await prisma.$transaction(async (tx) => {
    await tx.event.update({ where: { id: event.id }, data: { publishedRunId: null } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "results.unpublished", entityType: "Event", entityId: event.id, before: { publishedRunId: event.publishedRunId } });
  });
  res.json({ publishedRunId: null });
});

/**
 * The normalization proof for this event, as Markdown: raw vs adjusted ranking, judge leniency,
 * a seeded simulation on this event's own judge–project graph, and the integrity checks.
 * Contains judge names and scores, so it's organizer-only and every download is audited.
 */
resultsRouter.get("/normalization/report.md", async (req, res) => {
  const event = await staffEvent(req);
  const [inputs, integrity, target] = await Promise.all([loadResultInputs(prisma, event.id), computeIntegrity(event.id), reviewTarget(event.id)]);
  if (inputs.reviews.length === 0) throw new HttpError(409, "no_reviews", "There are no submitted reviews yet.");
  const computed = computeResults(inputs, normalizeOptions({ minReviews: target }));
  const judgeable = new Set(inputs.projects.filter((p) => !p.duplicateOfId).map((p) => p.id));
  const observations = inputs.reviews
    .filter((r) => judgeable.has(r.projectId))
    .map((r) => ({ judgeId: r.judgeId, projectId: r.projectId, score: compositeScore(r.scores, inputs.criteria) }))
    .filter((o): o is { judgeId: string; projectId: string; score: number } => o.score !== null);
  const judge = new Map(inputs.judges.map((j) => [j.id, j]));
  const project = new Map(inputs.projects.map((p) => [p.id, p]));
  const report = buildProofReport({
    title: event.name,
    computed,
    observations,
    integrity: {
      flags: integrity.flags,
      reliability: integrity.reliability,
      judgeName: (id) => judge.get(id)?.name ?? "Former judge",
      projectName: (id) => project.get(id)?.title ?? "?",
    },
    sim: { sims: 150 },
    command: `GET /api/events/${event.slug}/normalization/report.md`,
  });
  await prisma.$transaction((tx) =>
    appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "export.downloaded", entityType: "Event", entityId: event.id, after: { file: "normalization-report.md" } }),
  );
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${event.slug}-normalization-report.md"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(report);
});

/** Public. Only what a leaderboard needs: no judge data, no raw scores, no uncertainty internals. */
resultsRouter.get("/results", async (req, res) => {
  const event = await eventBySlug((req.params as { slug?: string }).slug);
  if (!event.publishedRunId) throw new HttpError(404, "results_not_published", "Results for this event haven't been published yet.");
  const [run, tracks, prizes] = await Promise.all([
    prisma.normalizationRun.findUniqueOrThrow({
      where: { id: event.publishedRunId },
      include: {
        results: {
          where: { rank: { not: null } },
          orderBy: { rank: "asc" },
          include: { project: { select: { id: true, title: true, tagline: true, thumbnailUrl: true, team: { select: { name: true, members: { select: { user: { select: { name: true } } } } } }, track: { select: { id: true, name: true } } } } },
        },
      },
    }),
    prisma.track.findMany({ where: { eventId: event.id }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.prize.findMany({ where: { eventId: event.id }, orderBy: [{ rank: "asc" }, { name: "asc" }], select: { id: true, name: true, value: true, rank: true, trackId: true } }),
  ]);
  res.json({
    event: { slug: event.slug, name: event.name },
    publishedRun: { id: run.id, method: run.method, computedAt: run.createdAt },
    tracks,
    prizes,
    results: run.results.map((r) => ({
      rank: r.rank,
      score: r.normalizedScore,
      reviews: r.nReviews,
      provisional: r.flags.includes("provisional"),
      project: { id: r.project.id, title: r.project.title, tagline: r.project.tagline, thumbnailUrl: r.project.thumbnailUrl, team: r.project.team.name, members: r.project.team.members.map((m) => m.user.name), track: r.project.track },
    })),
  });
});
