// From stored reviews to a ranked, flagged result: the bridge between the database and the
// pure engine in normalize.ts. Used by the organizer workbench, results.csv and the public page.
//
// The input fingerprint covers everything that can change a result (every submitted score, the
// rubric weights and ranges, which projects count, and the run options), so a saved run can
// always tell whether it still matches the data. Names and titles are left out on purpose:
// renaming a project doesn't make its result stale.
import type { Db } from "../db";
import { canonicalJson, sha256 } from "../lib/crypto";
import { compositeScore, type CriterionSpec } from "./composite";
import { normalize, rankBy, rankUncertainty, spearman, DEFAULT_PARAMS, type Observation } from "./normalize";

export const METHOD = "additive-ridge-v1";
export const LOW_SAMPLE = 3; // judges with fewer reviews get the low_sample flag
export const FLAT_SD = 0.25; // on the 1–5 composite scale
export const LENIENCY_FLAG = 0.25;

export type RunOptions = {
  lambdaJudge: number;
  lambdaProject: number;
  minReviews: number;
  excludedJudges: Array<{ judgeId: string; reason: string }>;
};

export async function loadResultInputs(db: Db, eventId: string) {
  const [criteria, reviews, projects, roles, overallPrizes] = await Promise.all([
    db.criterion.findMany({ where: { eventId }, orderBy: [{ position: "asc" }, { key: "asc" }] }),
    db.review.findMany({ where: { eventId, status: "submitted" }, select: { id: true, judgeId: true, projectId: true, scores: { select: { criterionId: true, value: true } } } }),
    db.project.findMany({
      where: { eventId, status: "submitted" },
      select: { id: true, externalId: true, title: true, tagline: true, thumbnailUrl: true, duplicateOfId: true, team: { select: { name: true } }, track: { select: { id: true, name: true } } },
    }),
    db.eventRole.findMany({ where: { eventId, role: "judge" }, select: { externalId: true, user: { select: { id: true, name: true } } } }),
    db.prize.count({ where: { eventId, trackId: null } }),
  ]);
  return {
    criteria: criteria.map((c): CriterionSpec => ({ id: c.id, key: c.key, weight: Number(c.weight), minScore: c.minScore, maxScore: c.maxScore })),
    reviews: reviews.map((r) => ({ id: r.id, judgeId: r.judgeId, projectId: r.projectId, scores: new Map(r.scores.map((s) => [s.criterionId, s.value])) })),
    projects,
    judges: roles.map((r) => ({ id: r.user.id, name: r.user.name, externalId: r.externalId })),
    topK: Math.max(3, overallPrizes),
  };
}
export type ResultInputs = Awaited<ReturnType<typeof loadResultInputs>>;

export function normalizeOptions(o: Partial<RunOptions> & { minReviews: number }): RunOptions {
  return {
    lambdaJudge: o.lambdaJudge ?? DEFAULT_PARAMS.lambdaJudge,
    lambdaProject: o.lambdaProject ?? DEFAULT_PARAMS.lambdaProject,
    minReviews: o.minReviews,
    excludedJudges: [...(o.excludedJudges ?? [])].sort((a, b) => a.judgeId.localeCompare(b.judgeId)),
  };
}

export function inputHash(inputs: ResultInputs, options: RunOptions): string {
  return sha256(
    canonicalJson({
      method: METHOD,
      criteria: [...inputs.criteria].sort((a, b) => a.id.localeCompare(b.id)),
      reviews: inputs.reviews
        .map((r) => ({ id: r.id, judgeId: r.judgeId, projectId: r.projectId, scores: [...r.scores.entries()].sort(([a], [b]) => a.localeCompare(b)) }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      projects: inputs.projects.map((p) => ({ id: p.id, duplicateOf: p.duplicateOfId })).sort((a, b) => a.id.localeCompare(b.id)),
      topK: inputs.topK,
      options,
    }),
  );
}

/** Group projects into connected components of the judge–project graph; returns project → component size. */
function componentSizes(obs: Observation[]): Map<string, number> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  };
  const add = (x: string) => parent.has(x) || parent.set(x, x);
  for (const o of obs) {
    const [j, p] = [`j:${o.judgeId}`, `p:${o.projectId}`];
    add(j);
    add(p);
    parent.set(find(j), find(p));
  }
  const size = new Map<string, number>();
  const projects = [...new Set(obs.map((o) => o.projectId))];
  for (const p of projects) size.set(find(`p:${p}`), (size.get(find(`p:${p}`)) ?? 0) + 1);
  return new Map(projects.map((p) => [p, size.get(find(`p:${p}`))!]));
}

export function computeResults(inputs: ResultInputs, options: RunOptions) {
  const excluded = new Map(options.excludedJudges.map((e) => [e.judgeId, e.reason]));
  const judgeable = new Set(inputs.projects.filter((p) => !p.duplicateOfId).map((p) => p.id));
  const composites = inputs.reviews
    .map((r) => ({ judgeId: r.judgeId, projectId: r.projectId, score: compositeScore(r.scores, inputs.criteria) }))
    .filter((o): o is Observation => o.score !== null);
  const obs = composites.filter((o) => judgeable.has(o.projectId) && !excluded.has(o.judgeId));
  const model = normalize(obs, { lambdaJudge: options.lambdaJudge, lambdaProject: options.lambdaProject });

  const est = new Map(model.projects.map((p) => [p.projectId, p]));
  const scored = model.projects.map((p) => ({ id: p.projectId, score: p.score, n: p.n, se: p.se }));
  const rank = rankBy(scored);
  const rawRank = rankBy(model.projects.map((p) => ({ id: p.projectId, score: p.raw, n: p.n })));
  const uncertainty = rankUncertainty(scored, { topK: inputs.topK });
  const sizes = componentSizes(obs);
  const largest = Math.max(0, ...sizes.values());

  const projects = inputs.projects
    .map((p) => {
      const e = est.get(p.id);
      const flags: string[] = [];
      if (p.duplicateOfId) flags.push("duplicate");
      else if (!e) flags.push("no_reviews");
      else {
        if (e.n < options.minReviews) flags.push("provisional");
        if (model.components > 1 && sizes.get(p.id)! < largest) flags.push("disconnected");
      }
      const u = e ? uncertainty.get(p.id)! : null;
      return {
        projectId: p.id,
        externalId: p.externalId,
        title: p.title,
        tagline: p.tagline,
        thumbnailUrl: p.thumbnailUrl,
        team: p.team.name,
        track: p.track,
        nReviews: e?.n ?? 0,
        rawScore: e?.raw ?? null,
        normalizedScore: e?.score ?? null,
        stdError: e?.se ?? null,
        rank: e ? rank.get(p.id)! : null,
        rawRank: e ? rawRank.get(p.id)! : null,
        rankLow: u?.rankLow ?? null,
        rankHigh: u?.rankHigh ?? null,
        pTop: u?.pTop ?? null,
        flags,
      };
    })
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.title.localeCompare(b.title));

  const judgeEst = new Map(model.judges.map((j) => [j.judgeId, j]));
  const judges = inputs.judges
    .map((j) => {
      const mine = composites.filter((o) => o.judgeId === j.id && judgeable.has(o.projectId)).map((o) => o.score);
      const e = judgeEst.get(j.id);
      const n = mine.length;
      const rawMean = n ? mine.reduce((s, x) => s + x, 0) / n : null;
      const sd = n >= 2 ? Math.sqrt(mine.reduce((s, x) => s + (x - rawMean!) ** 2, 0) / (n - 1)) : null;
      const offset = e?.offset ?? 0;
      const flags: string[] = [];
      if (excluded.has(j.id)) flags.push("excluded");
      if (n > 0 && n < LOW_SAMPLE) flags.push("low_sample");
      if (n >= LOW_SAMPLE && sd !== null && sd < FLAT_SD) flags.push("low_discrimination");
      if (e && offset >= LENIENCY_FLAG) flags.push("generous");
      if (e && offset <= -LENIENCY_FLAG) flags.push("harsh");
      return { judgeId: j.id, name: j.name, externalId: j.externalId, nReviews: n, rawMean, offset, stdDev: sd, flags, exclusionReason: excluded.get(j.id) ?? null };
    })
    .filter((j) => j.nReviews > 0 || j.flags.includes("excluded"))
    .sort((a, b) => b.offset - a.offset || a.name.localeCompare(b.name));

  const ranked = projects.filter((p) => p.rank !== null);
  return {
    summary: {
      mu: model.mu,
      sigma: model.sigma,
      iterations: model.iterations,
      converged: model.converged,
      components: model.components,
      reviewsUsed: obs.length,
      reviewsExcluded: composites.length - obs.length,
      projectsRanked: ranked.length,
      judgesUsed: model.judges.length,
      topK: inputs.topK,
      minReviews: options.minReviews,
      rankAgreement: spearman(rank, rawRank),
      rankChanges: ranked.filter((p) => p.rank !== p.rawRank).length,
      excluded: options.excludedJudges.map((e) => ({ ...e, name: inputs.judges.find((j) => j.id === e.judgeId)?.name ?? "?" })),
    },
    projects,
    judges,
  };
}
export type ComputedResults = ReturnType<typeof computeResults>;

/**
 * Compute and store an immutable run inside the caller's transaction. The route and the demo
 * seed both go through here, so a seeded run is exactly what an organizer would have produced.
 */
export async function persistRun(tx: Db, eventId: string, options: RunOptions, createdById: string | null, inputs?: ResultInputs) {
  const data = inputs ?? (await loadResultInputs(tx, eventId));
  const hash = inputHash(data, options);
  const computed = computeResults(data, options);
  const run = await tx.normalizationRun.create({
    data: {
      eventId,
      method: METHOD,
      params: options,
      weights: Object.fromEntries(data.criteria.map((c) => [c.key, c.weight])),
      inputHash: hash,
      componentCount: computed.summary.components,
      summary: computed.summary,
      createdById,
    },
  });
  await tx.projectResult.createMany({
    data: computed.projects.map((p) => ({
      runId: run.id, projectId: p.projectId, nReviews: p.nReviews, rawScore: p.rawScore, normalizedScore: p.normalizedScore, stdError: p.stdError,
      rank: p.rank, rawRank: p.rawRank, rankLow: p.rankLow, rankHigh: p.rankHigh, pTop: p.pTop, flags: p.flags,
    })),
  });
  await tx.judgeStat.createMany({
    data: computed.judges.map((j) => ({ runId: run.id, judgeId: j.judgeId, nReviews: j.nReviews, rawMean: j.rawMean, offset: j.offset, stdDev: j.stdDev, flags: j.flags })),
  });
  return { run, computed, hash };
}
