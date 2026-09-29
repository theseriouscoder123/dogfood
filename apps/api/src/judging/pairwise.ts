// Head-to-head judging: judges say which of two projects is better, and a Bradley–Terry model
// turns those judgements into a ranking.
//
// Why pairwise at all: a judge's 1–5 scores carry their personal scale (harsh, generous, flat),
// which the rubric pipeline has to model away. "A or B?" has no scale, so leniency cancels out
// by construction. It is also easier to answer consistently when two projects are close, which
// is exactly where rubric scores stop separating them. Here it runs beside the rubric, as a
// second, independent opinion the organizer can check the results against.
//
// Model. Each project i has a strength γᵢ > 0 and P(i beats j) = γᵢ / (γᵢ + γⱼ). A tie counts as
// half a win each way. Fitted by Hunter's MM algorithm (2004), which increases the likelihood at
// every step. Plain maximum likelihood breaks when a project never loses (γ → ∞) or the comparison
// graph falls apart into pieces (no common scale). So every project also gets PRIOR virtual games
// against a fixed anchor of strength 1: one win, one loss. That is a weak prior that pulls
// strengths toward the middle until the data says otherwise, and it keeps every estimate finite
// and on one scale.
//
// Ratings are reported on the familiar Elo scale (400 points = 10:1 odds, average 1500), with a
// standard error from the Fisher information, and 90% rank ranges from the same seeded simulation
// the rubric results use.
import { createHash } from "node:crypto";
import { rankBy, rankUncertainty, spearman } from "./normalize";

export type Outcome = "left" | "right" | "tie";
export type Comparison = { judgeId: string; left: string; right: string; outcome: Outcome };

export const PRIOR = 1; // virtual win + loss against the anchor, per project
const ELO = 400 / Math.LN10;

export type Strength = { id: string; theta: number; rating: number; se: number; wins: number; losses: number; ties: number; n: number };

/** Fit Bradley–Terry strengths. Deterministic; converges for any input thanks to the prior. */
export function fitBradleyTerry(ids: string[], comparisons: Comparison[], prior = PRIOR): Map<string, Strength> {
  const idx = new Map(ids.map((id, i) => [id, i]));
  const k = ids.length;
  const wins = new Array<number>(k).fill(0); // wins + half ties
  const w = new Array<number>(k).fill(0), l = new Array<number>(k).fill(0), t = new Array<number>(k).fill(0);
  const inc = (xs: number[], i: number, by = 1) => void (xs[i] = xs[i]! + by);
  const games = new Map<string, number>(); // "i,j" (i<j) → number of games
  for (const c of comparisons) {
    const a = idx.get(c.left), b = idx.get(c.right);
    if (a === undefined || b === undefined || a === b) continue;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    games.set(key, (games.get(key) ?? 0) + 1);
    if (c.outcome === "left") (inc(wins, a), inc(w, a), inc(l, b));
    else if (c.outcome === "right") (inc(wins, b), inc(w, b), inc(l, a));
    else (inc(wins, a, 0.5), inc(wins, b, 0.5), inc(t, a), inc(t, b));
  }
  const pairs = [...games.entries()].map(([key, n]) => {
    const [a, b] = key.split(",").map(Number) as [number, number];
    return { a, b, n };
  });
  let gamma = new Float64Array(k).fill(1);
  for (let iter = 0; iter < 5000; iter++) {
    const denom = Array.from({ length: k }, (_, i) => (2 * prior) / (gamma[i]! + 1)); // games against the anchor
    for (const { a, b, n } of pairs) {
      const s = n / (gamma[a]! + gamma[b]!);
      inc(denom, a, s);
      inc(denom, b, s);
    }
    const next = new Float64Array(k);
    let change = 0;
    for (let i = 0; i < k; i++) {
      next[i] = (wins[i]! + prior) / denom[i]!;
      change = Math.max(change, Math.abs(Math.log(next[i]! / gamma[i]!)));
    }
    gamma = next;
    if (change < 1e-10) break;
  }
  // Fisher information for log-strength: Σ n p(1−p) over every opponent, anchor included.
  const info = Array.from({ length: k }, (_, i) => {
    const p = gamma[i]! / (gamma[i]! + 1);
    return 2 * prior * p * (1 - p);
  });
  for (const { a, b, n } of pairs) {
    const p = gamma[a]! / (gamma[a]! + gamma[b]!);
    inc(info, a, n * p * (1 - p));
    inc(info, b, n * p * (1 - p));
  }
  const thetas = ids.map((_, i) => Math.log(gamma[i]!));
  const mean = thetas.reduce((s, x) => s + x, 0) / Math.max(1, k);
  return new Map(
    ids.map((id, i) => {
      const theta = thetas[i]! - mean;
      return [id, { id, theta, rating: 1500 + ELO * theta, se: 1 / Math.sqrt(info[i]!), wins: w[i]!, losses: l[i]!, ties: t[i]!, n: w[i]! + l[i]! + t[i]! }];
    }),
  );
}

/** P(a beats b) under fitted strengths. */
export const winProbability = (a: Strength, b: Strength) => 1 / (1 + Math.exp(b.theta - a.theta));

// ── choosing the next pair ─────────────────────────────────────────────────

export type Candidate = { projectId: string; myScore: number | null };

/**
 * The next pair for one judge, from their own assignments only. Prefers pairs that
 *   1. their own rubric scores can't separate (small gap, or not yet scored), and
 *   2. involve projects with few comparisons so far (from anyone: counts only, never outcomes).
 * Never repeats a pair for the same judge. Which side is shown on the left is decided by a hash,
 * so it's stable for a given judge and pair but carries no information.
 * Deliberately blind to other judges' opinions: a judge can't learn anything about the panel
 * from the pairs they're shown.
 */
export function choosePair(judgeId: string, candidates: Candidate[], done: Set<string>, counts: Map<string, number>): { left: string; right: string } | null {
  let best: { left: string; right: string; score: number; tiebreak: string } | null = null;
  for (let i = 0; i < candidates.length; i++)
    for (let j = i + 1; j < candidates.length; j++) {
      const [a, b] = [candidates[i]!, candidates[j]!];
      const key = pairKey(a.projectId, b.projectId);
      if (done.has(key)) continue;
      const gap = a.myScore !== null && b.myScore !== null ? Math.abs(a.myScore - b.myScore) : 0.5;
      const coverage = 1 / (1 + (counts.get(a.projectId) ?? 0)) + 1 / (1 + (counts.get(b.projectId) ?? 0));
      const score = coverage / (1 + 2 * gap);
      const h = createHash("sha256").update(`${judgeId}|${key}`).digest("hex");
      if (!best || score > best.score + 1e-12 || (Math.abs(score - best.score) <= 1e-12 && h < best.tiebreak)) {
        const flip = parseInt(h.slice(0, 2), 16) % 2 === 1;
        best = { left: flip ? b.projectId : a.projectId, right: flip ? a.projectId : b.projectId, score, tiebreak: h };
      }
    }
  return best && { left: best.left, right: best.right };
}

export const pairKey = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);

/** How many comparisons to suggest to a judge: about two per assigned project, capped by the pairs available. */
export const suggestedComparisons = (assigned: number) => Math.min((assigned * (assigned - 1)) / 2, 2 * assigned);

// ── analysis for organizers ────────────────────────────────────────────────

/** Does the left-hand project win suspiciously often? Two-sided binomial z-test against 50%. */
export function positionBias(comparisons: Comparison[]) {
  const decided = comparisons.filter((c) => c.outcome !== "tie");
  const leftWins = decided.filter((c) => c.outcome === "left").length;
  const n = decided.length;
  const z = n ? (leftWins - n / 2) / Math.sqrt(n / 4) : 0;
  return { decided: n, leftWins, leftShare: n ? leftWins / n : null, z, flagged: n >= 20 && Math.abs(z) >= 2.58 };
}

/** P(X <= k) for X ~ Binomial(n, 1/2). */
export function binomialLowerTail(k: number, n: number): number {
  let term = 0.5 ** n; // C(n, 0) / 2^n
  let sum = 0;
  for (let i = 0; i <= Math.min(k, n); i++) {
    sum += term;
    term = (term * (n - i)) / (i + 1);
  }
  return Math.min(1, sum);
}

/** A judge is "against the panel" only if siding with it this rarely is unlikely by chance (one-sided, p < 0.05). */
export const AGAINST_PANEL_P = 0.05;

/**
 * How often each judge sided with the rest of the panel. The model is refitted without that
 * judge (leave-one-out), so a judge doesn't get credit for agreeing with themselves.
 */
export function judgeAgreement(ids: string[], comparisons: Comparison[]) {
  const judges = [...new Set(comparisons.map((c) => c.judgeId))];
  return judges.map((judgeId) => {
    const mine = comparisons.filter((c) => c.judgeId === judgeId && c.outcome !== "tie");
    const others = fitBradleyTerry(ids, comparisons.filter((c) => c.judgeId !== judgeId));
    let agree = 0, informative = 0;
    for (const c of mine) {
      const p = winProbability(others.get(c.left)!, others.get(c.right)!);
      if (Math.abs(p - 0.5) < 0.05) continue; // the panel has no view on this pair
      informative++;
      if ((p > 0.5) === (c.outcome === "left")) agree++;
    }
    // Ten comparisons is a small sample: 3 of 9 happens by chance a quarter of the time, 1 of 11 doesn't.
    const pAgainst = informative ? binomialLowerTail(agree, informative) : null;
    return {
      judgeId, comparisons: comparisons.filter((c) => c.judgeId === judgeId).length, ties: comparisons.filter((c) => c.judgeId === judgeId && c.outcome === "tie").length,
      informative, agreement: informative ? agree / informative : null, pAgainst, againstPanel: pAgainst !== null && pAgainst < AGAINST_PANEL_P,
    };
  });
}

export type PairwiseRow = Strength & { rank: number; rankLow: number; rankHigh: number; rubricRank: number | null; disagreement: boolean };

/**
 * The full organizer view: ranking with uncertainty, and how it lines up with the rubric ranking.
 * A project is flagged when the two methods place it far apart and the pairwise data is solid
 * enough (4+ comparisons) for the gap to mean something.
 */
export function pairwiseReport(ids: string[], comparisons: Comparison[], rubricRanks: Map<string, number>) {
  const model = fitBradleyTerry(ids, comparisons);
  const compared = ids.filter((id) => model.get(id)!.n > 0);
  const ranks = rankBy(compared.map((id) => ({ id, score: model.get(id)!.theta, n: model.get(id)!.n })));
  const spread = rankUncertainty(compared.map((id) => ({ id, score: model.get(id)!.theta, se: model.get(id)!.se })), { seed: 20260929 });
  const threshold = Math.max(3, Math.ceil(compared.length * 0.2));
  const rows: PairwiseRow[] = compared
    .map((id) => {
      const s = model.get(id)!;
      const rubricRank = rubricRanks.get(id) ?? null;
      const rank = ranks.get(id)!;
      return { ...s, rank, rankLow: spread.get(id)!.rankLow, rankHigh: spread.get(id)!.rankHigh, rubricRank, disagreement: rubricRank !== null && s.n >= 4 && Math.abs(rank - rubricRank) >= threshold };
    })
    .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
  const shared = new Map([...rubricRanks].filter(([id]) => ranks.has(id)));
  return {
    rows,
    comparisons: comparisons.length,
    uncompared: ids.length - compared.length,
    agreement: spearman(ranks, shared),
    disagreementThreshold: threshold,
    positionBias: positionBias(comparisons),
    judges: judgeAgreement(ids, comparisons),
  };
}
