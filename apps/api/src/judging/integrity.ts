// Review integrity checks: deterministic statistics that point an organizer at reviews worth a
// second look. They never change a score or a ranking on their own; every flag is a question
// for a human, who can dismiss it or act on it (for example by excluding a judge from a run).
//
// Checks, and why each exists:
//   outlier            a review far from what this judge's habits and the other judges predict
//   comment_mismatch   the words say one thing, the score another ("Docs are thin." with 5/5/5)
//   identical_criteria a judge who gives every criterion the same number (halo effect)
//   low_discrimination a judge whose overall scores barely vary
//   disagrees_with_panel a judge whose scores run opposite to the other judges on the same projects
//   rushed / fast_reviewer  reviews submitted within seconds of opening the project
//   copy_paste         the same substantial comment pasted onto several projects
import type { Normalized } from "./normalize";

export const OUTLIER_Z = 2.5;
export const HIGH_SCORE = 4.25; // on the 1–5 composite scale
export const LOW_SCORE = 2.25;
export const HALO_SHARE = 0.75;
export const FLAT_SD = 0.25;
export const MIN_JUDGE_REVIEWS = 3;
export const PANEL_MIN_SHARED = 4;
export const PANEL_R = -0.3; // clearly opposite to the panel, not just noise around zero
export const RELIABLE_AVERAGE = 0.5; // ICC(1,k) below this: the ranking is mostly noise
export const RUSHED_SECONDS = 60;
export const FAST_MEDIAN_SECONDS = 120;
export const COPY_MIN_LENGTH = 25;
export const COPY_MIN_REPEATS = 3;

export type IntegrityReview = {
  reviewId: string;
  judgeId: string;
  projectId: string;
  values: number[]; // raw criterion values, rubric order
  composite: number; // 1–5
  comment: string;
  secondsToSubmit: number | null; // from first opening to submission; null when unknown
};

export type FlagType =
  | "outlier"
  | "comment_mismatch"
  | "identical_criteria"
  | "low_discrimination"
  | "disagrees_with_panel"
  | "rushed"
  | "fast_reviewer"
  | "copy_paste";

export type Flag = {
  key: string; // stable across recomputation, so an organizer's decision sticks
  type: FlagType;
  severity: "high" | "medium" | "low";
  judgeId: string;
  projectId: string | null;
  reviewId: string | null;
  summary: string;
  evidence: Record<string, unknown>;
};

const NEGATIVE = [
  "thin", "didn't run", "did not run", "doesn't run", "doesn't work", "does not work", "didn't work", "not working", "broken", "crash", "couldn't", "could not",
  "can't run", "cannot run", "missing", "incomplete", "no readme", "no docs", "unclear", "confusing", "buggy", "fails", "failed", "mocked", "hard to tell", "barely", "weak", "poor",
];
const POSITIVE = ["excellent", "outstanding", "impressive", "amazing", "great", "brilliant", "polished", "loved", "love it", "fantastic", "superb", "would use", "flawless", "worked first time"];

/** Very small lexicon sentiment: "negative", "positive", "mixed" or null (nothing recognised). */
export function commentTone(comment: string): "negative" | "positive" | "mixed" | null {
  const text = ` ${comment.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ")} `;
  let neg = NEGATIVE.some((w) => text.includes(w));
  let pos = false;
  for (const w of POSITIVE) {
    const i = text.indexOf(w);
    if (i < 0) continue;
    // "not great", "isn't polished" read as negative.
    if (/(?:not|n't|never|hardly) (?:very |that |so )?$/.test(text.slice(Math.max(0, i - 16), i))) neg = true;
    else pos = true;
  }
  return neg && pos ? "mixed" : neg ? "negative" : pos ? "positive" : null;
}

const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};
const medianOf = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
function pearson(xs: number[], ys: number[]): number | null {
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
}

/**
 * Inter-rater reliability of the event, as one-way intraclass correlations on the composites:
 * ICC(1) = how much a single review agrees with other reviews of the same project, and
 * ICC(1,k) = how reliable the average of k reviews is. Negative values are reported as 0.
 */
export function reliability(reviews: Array<{ projectId: string; composite: number }>) {
  const groups = new Map<string, number[]>();
  for (const r of reviews) groups.set(r.projectId, [...(groups.get(r.projectId) ?? []), r.composite]);
  const gs = [...groups.values()].filter((g) => g.length >= 2);
  const N = gs.reduce((s, g) => s + g.length, 0);
  const a = gs.length;
  if (a < 2 || N - a < 1) return null;
  const grand = mean(gs.flat());
  const ssb = gs.reduce((s, g) => s + g.length * (mean(g) - grand) ** 2, 0);
  const ssw = gs.reduce((s, g) => s + g.reduce((t, x) => t + (x - mean(g)) ** 2, 0), 0);
  const msb = ssb / (a - 1);
  const msw = ssw / (N - a);
  const k0 = (N - gs.reduce((s, g) => s + g.length ** 2, 0) / N) / (a - 1); // average group size, adjusted for imbalance
  const icc1 = (msb - msw) / (msb + (k0 - 1) * msw);
  const icck = msb === 0 ? 0 : (msb - msw) / msb;
  const average = Math.max(0, round(icck, 3));
  return { single: Math.max(0, round(icc1, 3)), average, reviewsPerProject: round(k0, 2), projects: a, reliable: average >= RELIABLE_AVERAGE };
}

export function integrityFlags(reviews: IntegrityReview[], model: Normalized): Flag[] {
  const flags: Flag[] = [];
  const byJudge = new Map<string, IntegrityReview[]>();
  const byProject = new Map<string, IntegrityReview[]>();
  for (const r of reviews) {
    byJudge.set(r.judgeId, [...(byJudge.get(r.judgeId) ?? []), r]);
    byProject.set(r.projectId, [...(byProject.get(r.projectId) ?? []), r]);
  }
  const residual = new Map(model.residuals.map((x) => [`${x.judgeId}|${x.projectId}`, x.residual]));
  const offset = new Map(model.judges.map((j) => [j.judgeId, j.offset]));
  const projectScore = new Map(model.projects.map((p) => [p.projectId, p.score]));

  for (const r of reviews) {
    // Outlier: the model predicts this judge's score for this project from everything else.
    // Residuals of a fitted model are smaller than the noise they estimate, most of all where a
    // project or judge has few reviews. Divide by σ·√(1 − h), with h the leverage of an
    // unshrunk two-way additive model (1/n_project + 1/n_judge − 1/N): approximately studentized.
    const e = residual.get(`${r.judgeId}|${r.projectId}`);
    // With a single review on either side the residual carries no information, so skip it.
    const np = byProject.get(r.projectId)?.length ?? 0;
    const nj = byJudge.get(r.judgeId)!.length;
    if (e !== undefined && model.sigma > 0 && np >= 2 && nj >= 2) {
      const h = Math.min(0.9, 1 / np + 1 / nj - 1 / reviews.length);
      const z = e / (model.sigma * Math.sqrt(1 - h));
      if (Math.abs(z) >= OUTLIER_Z) {
        const expected = projectScore.get(r.projectId)! + offset.get(r.judgeId)!;
        flags.push({
          key: `outlier:${r.reviewId}`, type: "outlier", severity: Math.abs(z) >= 3 ? "high" : "medium",
          judgeId: r.judgeId, projectId: r.projectId, reviewId: r.reviewId,
          summary: `Scored ${round(Math.abs(e))} ${e < 0 ? "below" : "above"} what this judge's habits and the other reviews predict (z = ${round(z, 1)}).`,
          evidence: { score: round(r.composite), expected: round(expected), z: round(z, 2) },
        });
      }
    }
    // Words versus numbers.
    const tone = commentTone(r.comment);
    if ((tone === "negative" && r.composite >= HIGH_SCORE) || (tone === "positive" && r.composite <= LOW_SCORE)) {
      flags.push({
        key: `comment_mismatch:${r.reviewId}`, type: "comment_mismatch", severity: "medium",
        judgeId: r.judgeId, projectId: r.projectId, reviewId: r.reviewId,
        summary: `A ${tone} comment on a ${tone === "negative" ? "high" : "low"} score (${round(r.composite)} of 5). Worth checking the numbers were entered as intended.`,
        evidence: { score: round(r.composite), comment: r.comment, tone },
      });
    }
    if (r.secondsToSubmit !== null && r.secondsToSubmit < RUSHED_SECONDS) {
      flags.push({
        key: `rushed:${r.reviewId}`, type: "rushed", severity: "low",
        judgeId: r.judgeId, projectId: r.projectId, reviewId: r.reviewId,
        summary: `Submitted ${Math.round(r.secondsToSubmit)} seconds after first opening the project.`,
        evidence: { seconds: Math.round(r.secondsToSubmit) },
      });
    }
  }

  for (const [judgeId, mine] of byJudge) {
    const n = mine.length;
    const composites = mine.map((r) => r.composite);

    const multi = mine.filter((r) => r.values.length >= 2);
    const identical = multi.filter((r) => new Set(r.values).size === 1);
    if (multi.length >= MIN_JUDGE_REVIEWS && identical.length / multi.length >= HALO_SHARE) {
      flags.push({
        key: `identical_criteria:${judgeId}`, type: "identical_criteria", severity: "medium", judgeId, projectId: null, reviewId: null,
        summary: `Gave every criterion the same score in ${identical.length} of ${multi.length} reviews, so the rubric's separate criteria aren't really being judged.`,
        evidence: { identical: identical.length, reviews: multi.length },
      });
    }
    if (n >= MIN_JUDGE_REVIEWS && sd(composites) < FLAT_SD) {
      flags.push({
        key: `low_discrimination:${judgeId}`, type: "low_discrimination", severity: "medium", judgeId, projectId: null, reviewId: null,
        summary: `Scores barely vary (spread ${round(sd(composites))} across ${n} projects), so this judge adds little to the ranking.`,
        evidence: { spread: round(sd(composites)), reviews: n, mean: round(mean(composites)) },
      });
    }

    // Leave-one-out agreement: this judge's score versus the other judges' average, project by project.
    const pairs = mine
      .map((r) => {
        const others = (byProject.get(r.projectId) ?? []).filter((o) => o.judgeId !== judgeId).map((o) => o.composite);
        return others.length ? [r.composite, mean(others)] : null;
      })
      .filter((x): x is number[] => x !== null);
    if (pairs.length >= PANEL_MIN_SHARED) {
      const rho = pearson(pairs.map((p) => p[0]!), pairs.map((p) => p[1]!));
      if (rho !== null && rho <= PANEL_R) {
        flags.push({
          key: `disagrees_with_panel:${judgeId}`, type: "disagrees_with_panel", severity: rho <= -0.6 ? "high" : "medium", judgeId, projectId: null, reviewId: null,
          summary: `Across ${pairs.length} shared projects, this judge tends to score high where the other judges score low, and vice versa (r = ${round(rho)}).`,
          evidence: { correlation: round(rho, 3), sharedProjects: pairs.length },
        });
      }
    }

    const timed = mine.map((r) => r.secondsToSubmit).filter((s): s is number => s !== null);
    if (timed.length >= MIN_JUDGE_REVIEWS && medianOf(timed) < FAST_MEDIAN_SECONDS) {
      flags.push({
        key: `fast_reviewer:${judgeId}`, type: "fast_reviewer", severity: "medium", judgeId, projectId: null, reviewId: null,
        summary: `Median of ${Math.round(medianOf(timed))} seconds from opening a project to submitting its review, over ${timed.length} reviews.`,
        evidence: { medianSeconds: Math.round(medianOf(timed)), timedReviews: timed.length },
      });
    }

    const counts = new Map<string, number>();
    for (const r of mine) {
      const text = r.comment.trim().toLowerCase().replace(/\s+/g, " ");
      if (text.length >= COPY_MIN_LENGTH) counts.set(text, (counts.get(text) ?? 0) + 1);
    }
    for (const [text, times] of counts) {
      if (times < COPY_MIN_REPEATS) continue;
      flags.push({
        key: `copy_paste:${judgeId}:${text.slice(0, 40)}`, type: "copy_paste", severity: "low", judgeId, projectId: null, reviewId: null,
        summary: `Used the same comment on ${times} different projects.`,
        evidence: { comment: text, times },
      });
    }
  }

  const order = { high: 0, medium: 1, low: 2 };
  return flags.sort((a, b) => order[a.severity] - order[b.severity] || a.type.localeCompare(b.type) || a.key.localeCompare(b.key));
}
