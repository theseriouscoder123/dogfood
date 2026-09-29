import { describe, expect, it } from "vitest";
import { choosePair, fitBradleyTerry, pairKey, pairwiseReport, positionBias, suggestedComparisons, winProbability, type Comparison } from "../../src/judging/pairwise";
import { rng } from "../../src/judging/assign";
import { rankBy, spearman } from "../../src/judging/normalize";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${String(i).padStart(2, "0")}`);

/** Simulated panel: true log-strengths spread evenly, each judge compares random pairs honestly. */
function simulate(n: number, judges: number, perJudge: number, seed = 7, contrarian?: string) {
  const random = rng(seed);
  const truth = new Map(ids(n).map((id, i) => [id, (i - n / 2) * 0.25]));
  const out: Comparison[] = [];
  for (let j = 0; j < judges; j++) {
    const judgeId = `j${j}`;
    for (let c = 0; c < perJudge; c++) {
      const a = Math.floor(random() * n);
      let b = Math.floor(random() * (n - 1));
      if (b >= a) b++;
      const [left, right] = [ids(n)[a]!, ids(n)[b]!];
      const p = 1 / (1 + Math.exp(truth.get(right)! - truth.get(left)!));
      const leftWins = random() < p;
      const honest: Comparison["outcome"] = leftWins ? "left" : "right";
      const flipped: Comparison["outcome"] = leftWins ? "right" : "left";
      out.push({ judgeId, left, right, outcome: judgeId === contrarian ? flipped : honest });
    }
  }
  return { truth, comparisons: out };
}

describe("Bradley–Terry fit", () => {
  it("recovers the true order from noisy comparisons", () => {
    const { truth, comparisons } = simulate(20, 12, 40);
    const fit = fitBradleyTerry(ids(20), comparisons);
    const fitted = rankBy(ids(20).map((id) => ({ id, score: fit.get(id)!.theta, n: 1 })));
    const real = rankBy(ids(20).map((id) => ({ id, score: truth.get(id)!, n: 1 })));
    expect(spearman(fitted, real)!).toBeGreaterThan(0.9);
  });

  it("keeps a project that never lost finite, and on top", () => {
    const c: Comparison[] = [
      { judgeId: "j", left: "a", right: "b", outcome: "left" },
      { judgeId: "j", left: "a", right: "c", outcome: "left" },
      { judgeId: "j", left: "b", right: "c", outcome: "left" },
    ];
    const fit = fitBradleyTerry(["a", "b", "c"], c);
    expect(Number.isFinite(fit.get("a")!.theta)).toBe(true);
    expect(fit.get("a")!.theta).toBeGreaterThan(fit.get("b")!.theta);
    expect(fit.get("b")!.theta).toBeGreaterThan(fit.get("c")!.theta);
  });

  it("stays on one scale when the comparison graph is in pieces", () => {
    const c: Comparison[] = [
      { judgeId: "j", left: "a", right: "b", outcome: "left" },
      { judgeId: "k", left: "x", right: "y", outcome: "right" },
    ];
    const fit = fitBradleyTerry(["a", "b", "x", "y"], c);
    for (const s of fit.values()) expect(Number.isFinite(s.theta) && Number.isFinite(s.se)).toBe(true);
    expect(fit.get("a")!.theta).toBeCloseTo(fit.get("y")!.theta, 9); // same record, same strength
  });

  it("treats a tie as half a win each way", () => {
    const c: Comparison[] = [
      { judgeId: "j", left: "a", right: "b", outcome: "tie" },
      { judgeId: "k", left: "b", right: "a", outcome: "tie" },
    ];
    const fit = fitBradleyTerry(["a", "b"], c);
    expect(fit.get("a")!.theta).toBeCloseTo(fit.get("b")!.theta, 9);
    expect(winProbability(fit.get("a")!, fit.get("b")!)).toBeCloseTo(0.5, 9);
    expect(fit.get("a")).toMatchObject({ ties: 2, n: 2 });
  });

  it("is more certain about projects it has seen more of", () => {
    const { comparisons } = simulate(10, 6, 30);
    const extra = comparisons.concat(Array.from({ length: 40 }, (_, i) => ({ judgeId: "x", left: "p00", right: `p0${1 + (i % 9)}`, outcome: (i % 2 ? "left" : "right") as Comparison["outcome"] })));
    const fit = fitBradleyTerry(ids(10), extra);
    expect(fit.get("p00")!.se).toBeLessThan(fit.get("p05")!.se);
  });
});

describe("choosing the next pair", () => {
  const cands = [
    { projectId: "a", myScore: 4.0 },
    { projectId: "b", myScore: 4.1 },
    { projectId: "c", myScore: 2.0 },
    { projectId: "d", myScore: null },
  ];

  it("prefers the pair the judge's own scores can't separate", () => {
    const p = choosePair("j1", cands, new Set(), new Map());
    expect([p!.left, p!.right].sort()).toEqual(["a", "b"]);
  });

  it("never repeats a pair, and runs out cleanly", () => {
    const done = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const p = choosePair("j1", cands, done, new Map())!;
      expect(done.has(pairKey(p.left, p.right))).toBe(false);
      done.add(pairKey(p.left, p.right));
    }
    expect(choosePair("j1", cands, done, new Map())).toBeNull();
  });

  it("spreads comparisons to projects that have had few", () => {
    const counts = new Map([["a", 30], ["b", 30]]);
    const p = choosePair("j1", cands, new Set(), counts)!;
    expect([p.left, p.right]).not.toEqual(expect.arrayContaining(["a", "b"]));
  });

  it("is deterministic, and doesn't always put the same project on the left", () => {
    expect(choosePair("j1", cands, new Set(), new Map())).toEqual(choosePair("j1", cands, new Set(), new Map()));
    const lefts = new Set(Array.from({ length: 30 }, (_, i) => choosePair(`judge-${i}`, cands, new Set(), new Map())!.left));
    expect(lefts.size).toBe(2); // a and b both appear on the left for different judges
  });

  it("suggests about two comparisons per project, capped by the pairs available", () => {
    expect(suggestedComparisons(2)).toBe(1);
    expect(suggestedComparisons(4)).toBe(6);
    expect(suggestedComparisons(10)).toBe(20);
  });
});

describe("organizer analysis", () => {
  it("flags a panel that keeps picking whatever is on the left", () => {
    const c = Array.from({ length: 40 }, (_, i) => ({ judgeId: "j", left: `p${i}`, right: `q${i}`, outcome: (i < 34 ? "left" : "right") as Comparison["outcome"] }));
    expect(positionBias(c)).toMatchObject({ decided: 40, leftWins: 34, flagged: true });
    expect(positionBias(c.slice(0, 10)).flagged).toBe(false); // too few to say
  });

  it("singles out a judge who disagrees with the rest of the panel", () => {
    const { comparisons } = simulate(12, 8, 40, 11, "j3");
    const report = pairwiseReport(ids(12), comparisons, new Map());
    const agreement = new Map(report.judges.map((j) => [j.judgeId, j.agreement!]));
    expect(agreement.get("j3")!).toBeLessThan(0.35);
    for (const [id, a] of agreement) if (id !== "j3") expect(a).toBeGreaterThan(0.6);
  });

  it("flags projects the rubric and the comparisons place far apart", () => {
    const { comparisons } = simulate(15, 10, 40, 5);
    // The rubric agrees with the truth, except that it ranks the weakest project (p00) first.
    const rubric = new Map(ids(15).map((id, i) => [id, i === 0 ? 1 : 16 - i]));
    const report = pairwiseReport(ids(15), comparisons, rubric);
    expect(report.rows.find((r) => r.id === "p00")!.disagreement).toBe(true);
    expect(report.agreement!).toBeGreaterThan(0.5);
  });
});
