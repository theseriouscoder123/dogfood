// Normalization: an additive judge-effect model with ridge shrinkage. Pure functions, no I/O.
//
// Model: judge j gives project p the composite score
//
//     x_jp = μ + a_p + b_j + ε_jp
//
//   μ    overall mean
//   a_p  project quality (what we rank on)
//   b_j  judge leniency: positive = generous, negative = harsh
//   ε    noise
//
// Estimated by minimizing  Σ (x_jp − μ − a_p − b_j)²  +  λ_j Σ b_j²  +  λ_p Σ a_p²
// (ridge regression; equivalently the BLUP of a random-effects model with λ = σ²_noise / σ²_effect).
// Solved by coordinate descent ("backfitting"): each update is the exact minimizer for one block
// with the others fixed, so the objective falls every step and, being strictly convex, converges
// to its unique minimum. No random start, so the result is fully deterministic.
//
// Why not per-judge z-scores: most judges review 3–6 projects, and a standard deviation from
// three numbers is mostly noise; a judge who gives everything the same score divides by zero.
// Shrinkage handles small samples instead: a judge with n reviews can move their own offset by
// at most n/(n+λ_j) of their average deviation. See JUDGING.md for the simulation evidence.
import { countComponents, rng } from "./assign";

export type Observation = { judgeId: string; projectId: string; score: number };
export type NormalizeParams = { lambdaJudge: number; lambdaProject: number };
// Chosen by simulation on the fixture's real judge–project graph (JUDGING.md has the sweep):
// λ_j = 2 is within 0.001 of the best ρ when judges are biased and costs half as much as
// λ_j = 1 when they aren't; it also sits near the theoretical σ²_noise / σ²_bias ≈ 1.6.
export const DEFAULT_PARAMS: NormalizeParams = { lambdaJudge: 2, lambdaProject: 0.5 };

export type ProjectEstimate = { projectId: string; n: number; raw: number; effect: number; score: number; se: number };
export type JudgeEstimate = { judgeId: string; n: number; rawMean: number; offset: number; sd: number | null };
export type Normalized = {
  mu: number;
  sigma: number; // residual standard deviation (noise)
  iterations: number;
  converged: boolean;
  components: number;
  projects: ProjectEstimate[];
  judges: JudgeEstimate[];
  residuals: Array<{ judgeId: string; projectId: string; residual: number }>;
};

const TOLERANCE = 1e-10;
const MAX_ITERATIONS = 10_000;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function normalize(input: Observation[], params: NormalizeParams = DEFAULT_PARAMS): Normalized {
  // Canonical order, so the result never depends on the order rows came out of the database.
  const obs = [...input].sort((x, y) => x.judgeId.localeCompare(y.judgeId) || x.projectId.localeCompare(y.projectId));
  const judgeIds = [...new Set(obs.map((o) => o.judgeId))].sort();
  const projectIds = [...new Set(obs.map((o) => o.projectId))].sort();
  if (obs.length === 0) return { mu: 0, sigma: 0, iterations: 0, converged: true, components: 0, projects: [], judges: [], residuals: [] };

  const byJudge = new Map(judgeIds.map((id) => [id, [] as Observation[]]));
  const byProject = new Map(projectIds.map((id) => [id, [] as Observation[]]));
  for (const o of obs) {
    byJudge.get(o.judgeId)!.push(o);
    byProject.get(o.projectId)!.push(o);
  }

  let mu = mean(obs.map((o) => o.score));
  const a = new Map(projectIds.map((id) => [id, 0]));
  const b = new Map(judgeIds.map((id) => [id, 0]));
  let iterations = 0;
  let converged = false;
  while (iterations < MAX_ITERATIONS) {
    iterations++;
    let delta = 0;
    const step = (map: Map<string, number>, key: string, next: number) => {
      delta = Math.max(delta, Math.abs(next - map.get(key)!));
      map.set(key, next);
    };
    for (const [j, rows] of byJudge) step(b, j, rows.reduce((s, o) => s + o.score - mu - a.get(o.projectId)!, 0) / (rows.length + params.lambdaJudge));
    for (const [p, rows] of byProject) step(a, p, rows.reduce((s, o) => s + o.score - mu - b.get(o.judgeId)!, 0) / (rows.length + params.lambdaProject));
    const nextMu = mean(obs.map((o) => o.score - a.get(o.projectId)! - b.get(o.judgeId)!));
    delta = Math.max(delta, Math.abs(nextMu - mu));
    mu = nextMu;
    if (delta < TOLERANCE) {
      converged = true;
      break;
    }
  }

  const residuals = obs.map((o) => ({ judgeId: o.judgeId, projectId: o.projectId, residual: o.score - mu - a.get(o.projectId)! - b.get(o.judgeId)! }));
  // Degrees of freedom: observations minus fitted effects, floored so tiny events still get a number.
  const df = obs.length - projectIds.length - judgeIds.length + 1;
  const rss = residuals.reduce((s, r) => s + r.residual ** 2, 0);
  const sigma = Math.sqrt(rss / (df > 0 ? df : obs.length));

  return {
    mu,
    sigma,
    iterations,
    converged,
    components: countComponents(obs),
    projects: projectIds.map((p) => {
      const rows = byProject.get(p)!;
      return { projectId: p, n: rows.length, raw: mean(rows.map((o) => o.score)), effect: a.get(p)!, score: mu + a.get(p)!, se: sigma / Math.sqrt(rows.length + params.lambdaProject) };
    }),
    judges: judgeIds.map((j) => {
      const s = byJudge.get(j)!.map((o) => o.score);
      const m = mean(s);
      return { judgeId: j, n: s.length, rawMean: m, offset: b.get(j)!, sd: s.length >= 2 ? Math.sqrt(s.reduce((acc, x) => acc + (x - m) ** 2, 0) / (s.length - 1)) : null };
    }),
    residuals,
  };
}

/** Rank items by score (higher first); ties broken by more reviews, then id, so ranks are stable. */
export function rankBy<T extends { id: string; score: number; n: number }>(items: T[]): Map<string, number> {
  const sorted = [...items].sort((x, y) => y.score - x.score || y.n - x.n || x.id.localeCompare(y.id));
  // Competition ranking ("1, 2, 2, 4"): projects the data can't separate (same score, same number of
  // reviews) share a rank. Splitting them by id would be arbitrary, and would change when the event
  // is exported and imported elsewhere, because ids do.
  const ranks = new Map<string, number>();
  let rank = 0;
  sorted.forEach((x, i) => {
    const prev = sorted[i - 1];
    if (!prev || Math.abs(prev.score - x.score) > 1e-9 || prev.n !== x.n) rank = i + 1;
    ranks.set(x.id, rank);
  });
  return ranks;
}

/**
 * How sure is each rank? Draw every project's score from N(score, se²) many times and record
 * where it lands. Reports the 5th–95th percentile rank and the chance of finishing in the top k.
 * Treats projects as independent (an approximation: estimates that share judges are correlated),
 * and is seeded, so the same inputs always give the same answer.
 */
export function rankUncertainty(items: Array<{ id: string; score: number; se: number }>, opts: { draws?: number; topK?: number; seed?: number } = {}) {
  const draws = opts.draws ?? 2000;
  const topK = Math.max(1, opts.topK ?? 3);
  const random = rng(opts.seed ?? 20260928);
  const gaussian = () => {
    const u = Math.max(random(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
  };
  const ranks = new Map(items.map((x) => [x.id, [] as number[]]));
  const top = new Map(items.map((x) => [x.id, 0]));
  for (let d = 0; d < draws; d++) {
    const sample = items.map((x) => ({ id: x.id, v: x.score + x.se * gaussian() })).sort((p, q) => q.v - p.v || p.id.localeCompare(q.id));
    sample.forEach((s, i) => {
      ranks.get(s.id)!.push(i + 1);
      if (i < topK) top.set(s.id, top.get(s.id)! + 1);
    });
  }
  const pct = (xs: number[], q: number) => xs[Math.min(xs.length - 1, Math.max(0, Math.round(q * (xs.length - 1))))]!;
  return new Map(
    items.map((x) => {
      const r = ranks.get(x.id)!.sort((p, q) => p - q);
      return [x.id, { rankLow: pct(r, 0.05), rankHigh: pct(r, 0.95), pTop: top.get(x.id)! / draws }];
    }),
  );
}

/** Spearman rank correlation between two rankings of the same ids (1 = identical order). */
export function spearman(r1: Map<string, number>, r2: Map<string, number>): number | null {
  const ids = [...r1.keys()].filter((id) => r2.has(id));
  const n = ids.length;
  if (n < 2) return null;
  // Re-rank within the shared ids so both sides are a permutation of 1..n.
  const dense = (r: Map<string, number>) => new Map([...ids].sort((x, y) => r.get(x)! - r.get(y)!).map((id, i) => [id, i + 1]));
  const [a, b] = [dense(r1), dense(r2)];
  const d2 = ids.reduce((s, id) => s + (a.get(id)! - b.get(id)!) ** 2, 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
}
