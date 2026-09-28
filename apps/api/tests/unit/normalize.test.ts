// Properties of the normalization engine, on synthetic events and on the official fixtures.
import { describe, expect, it } from "vitest";
import { normalize, rankBy, rankUncertainty, spearman, DEFAULT_PARAMS, type Observation } from "../../src/judging/normalize";
import { rng } from "../../src/judging/assign";
import fixtures from "../../../../data/fixtures.json";

const byId = <T extends { projectId: string }>(xs: T[]) => new Map(xs.map((x) => [x.projectId, x]));
const ranking = (res: ReturnType<typeof normalize>, key: "score" | "raw") => rankBy(res.projects.map((p) => ({ id: p.projectId, score: p[key], n: p.n })));

/** A connected event: every project gets `k` judges from a pool, with known quality and bias. */
function simulate(seed: number, opts: { projects?: number; judges?: number; k?: number; biasSd?: number; noiseSd?: number } = {}) {
  const r = rng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(r(), 1e-12))) * Math.cos(2 * Math.PI * r());
  const P = opts.projects ?? 30, J = opts.judges ?? 12, k = opts.k ?? 3;
  const quality = Array.from({ length: P }, () => 3 + 0.6 * gauss());
  const bias = Array.from({ length: J }, () => (opts.biasSd ?? 0.5) * gauss());
  const obs: Observation[] = [];
  for (let p = 0; p < P; p++)
    for (let i = 0; i < k; i++) {
      const j = (p * 5 + i * 7) % J; // deterministic, overlapping, connected design
      obs.push({ judgeId: `j${String(j).padStart(2, "0")}`, projectId: `p${String(p).padStart(2, "0")}`, score: quality[p]! + bias[j]! + (opts.noiseSd ?? 0.3) * gauss() });
    }
  const truth = rankBy(quality.map((q, p) => ({ id: `p${String(p).padStart(2, "0")}`, score: q, n: 0 })));
  return { obs, truth, bias };
}

describe("normalize: basic guarantees", () => {
  it("handles an empty event", () => {
    expect(normalize([])).toMatchObject({ projects: [], judges: [], converged: true });
  });

  it("converges to finite numbers, deterministically", () => {
    const { obs } = simulate(1);
    const a = normalize(obs);
    expect(a.converged).toBe(true);
    for (const p of a.projects) expect(Number.isFinite(p.score) && Number.isFinite(p.se)).toBe(true);
    expect(normalize(obs)).toEqual(a);
  });

  it("does not depend on the order of the input rows", () => {
    const { obs } = simulate(2);
    const shuffled = [...obs].sort(() => rng(9)() - 0.5).reverse();
    expect(normalize(shuffled)).toEqual(normalize(obs));
  });

  it("is translation-equivariant: adding c to every score adds c to every result", () => {
    const { obs } = simulate(3);
    const a = normalize(obs);
    const b = normalize(obs.map((o) => ({ ...o, score: o.score + 1.5 })));
    const pa = byId(a.projects);
    for (const p of b.projects) expect(p.score).toBeCloseTo(pa.get(p.projectId)!.score + 1.5, 8);
    for (const [i, j] of b.judges.entries()) expect(j.offset).toBeCloseTo(a.judges[i]!.offset, 8);
  });

  it("is scale-equivariant: multiplying every score by k multiplies effects by k", () => {
    const { obs } = simulate(4);
    const a = normalize(obs);
    const b = normalize(obs.map((o) => ({ ...o, score: o.score * 2 })));
    for (const [i, j] of b.judges.entries()) expect(j.offset).toBeCloseTo(a.judges[i]!.offset * 2, 8);
    expect(b.sigma).toBeCloseTo(a.sigma * 2, 8);
  });

  it("barely moves anything when judges are unbiased and noise-free", () => {
    // Not exactly zero, by design: shrinking project effects (λ_p > 0) lets a little of a
    // strong batch's quality leak into its judge's offset. The simulations price that in.
    const { obs } = simulate(5, { biasSd: 0, noiseSd: 0 });
    const res = normalize(obs);
    expect(spearman(ranking(res, "score"), ranking(res, "raw"))).toBeGreaterThan(0.99);
    for (const j of res.judges) expect(Math.abs(j.offset)).toBeLessThan(0.1);
  });
  it("matches raw exactly without project shrinkage", () => {
    const { obs } = simulate(5, { biasSd: 0, noiseSd: 0 });
    const res = normalize(obs, { lambdaJudge: 2, lambdaProject: 0 });
    for (const p of res.projects) expect(p.score).toBeCloseTo(p.raw, 8);
  });
});

describe("normalize: what it is for", () => {
  it("undoes a harsh and a generous judge that raw means get wrong", () => {
    // A (truly 4.0) is only seen by the harsh judge H, B (truly 3.5) only by the generous G.
    // Both judges also score three shared anchor projects, which reveals their bias.
    const obs: Observation[] = [
      ...["z1", "z2", "z3"].flatMap((z, i) => [
        { judgeId: "H", projectId: z, score: 2 + i * 0.5 },
        { judgeId: "G", projectId: z, score: 4 + i * 0.5 },
        { judgeId: "N", projectId: z, score: 3 + i * 0.5 },
      ]),
      { judgeId: "H", projectId: "A", score: 3.0 },
      { judgeId: "N", projectId: "A", score: 4.0 },
      { judgeId: "G", projectId: "B", score: 4.5 },
      { judgeId: "N", projectId: "B", score: 3.5 },
    ];
    const res = normalize(obs);
    const p = byId(res.projects);
    expect(p.get("B")!.raw).toBeGreaterThan(p.get("A")!.raw); // raw means are fooled...
    expect(p.get("A")!.score).toBeGreaterThan(p.get("B")!.score); // ...the model is not
    const offset = new Map(res.judges.map((j) => [j.judgeId, j.offset]));
    expect(offset.get("H")!).toBeLessThan(-0.5);
    expect(offset.get("G")!).toBeGreaterThan(0.5);
  });

  it("recovers the true ranking better than raw means across 100 biased events", () => {
    let raw = 0, model = 0;
    for (let s = 1; s <= 100; s++) {
      const { obs, truth } = simulate(1000 + s, { biasSd: 0.6, noiseSd: 0.35 });
      const res = normalize(obs);
      raw += spearman(truth, ranking(res, "raw"))!;
      model += spearman(truth, ranking(res, "score"))!;
    }
    expect(model / 100).toBeGreaterThan(raw / 100 + 0.02);
  });

  it("costs almost nothing when judges are fair", () => {
    let raw = 0, model = 0;
    for (let s = 1; s <= 100; s++) {
      const { obs, truth } = simulate(2000 + s, { biasSd: 0, noiseSd: 0.35 });
      const res = normalize(obs);
      raw += spearman(truth, ranking(res, "raw"))!;
      model += spearman(truth, ranking(res, "score"))!;
    }
    expect(model / 100).toBeGreaterThan(raw / 100 - 0.02);
  });

  it("shrinks a single-review judge's offset toward zero", () => {
    const { obs } = simulate(6);
    const lone: Observation = { judgeId: "zz-lone", projectId: obs[0]!.projectId, score: 5 };
    const res = normalize([...obs, lone]);
    const j = res.judges.find((x) => x.judgeId === "zz-lone")!;
    const p = res.projects.find((x) => x.projectId === lone.projectId)!;
    const deviation = 5 - res.mu - p.effect;
    expect(j.n).toBe(1);
    expect(j.offset).toBeCloseTo(deviation / (1 + DEFAULT_PARAMS.lambdaJudge), 6);
    expect(j.sd).toBeNull();
  });

  it("copes with a judge who gives everything the same score", () => {
    const { obs } = simulate(7);
    const flat = obs.map((o) => (o.judgeId === "j00" ? { ...o, score: 4 } : o));
    const res = normalize(flat);
    const j = res.judges.find((x) => x.judgeId === "j00")!;
    expect(j.sd).toBe(0);
    expect(res.projects.every((p) => Number.isFinite(p.score))).toBe(true);
  });

  it("reports disconnected judge groups", () => {
    const obs: Observation[] = [
      { judgeId: "a", projectId: "p1", score: 3 }, { judgeId: "b", projectId: "p1", score: 4 },
      { judgeId: "c", projectId: "p2", score: 2 }, { judgeId: "d", projectId: "p2", score: 5 },
    ];
    expect(normalize(obs).components).toBe(2);
  });
});

describe("rankUncertainty", () => {
  it("is certain about a runaway leader and unsure about a close race", () => {
    const u = rankUncertainty([
      { id: "leader", score: 4.8, se: 0.1 },
      { id: "x", score: 3.0, se: 0.3 },
      { id: "y", score: 3.01, se: 0.3 },
      { id: "z", score: 2.99, se: 0.3 },
    ], { topK: 1 });
    expect(u.get("leader")).toEqual({ rankLow: 1, rankHigh: 1, pTop: 1 });
    expect(u.get("x")!.rankHigh - u.get("x")!.rankLow).toBeGreaterThanOrEqual(2);
  });
  it("is seeded: same inputs, same answer", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, score: 3 + i * 0.05, se: 0.2 }));
    expect(rankUncertainty(items)).toEqual(rankUncertainty(items));
  });
});

describe("spearman", () => {
  it("is 1 for identical order, -1 for reversed, and ignores ids missing on one side", () => {
    const a = new Map([["a", 1], ["b", 2], ["c", 3]]);
    expect(spearman(a, new Map([["a", 1], ["b", 2], ["c", 3]]))).toBe(1);
    expect(spearman(a, new Map([["a", 3], ["b", 2], ["c", 1]]))).toBe(-1);
    expect(spearman(a, new Map([["a", 5], ["c", 9], ["zz", 1]]))).toBe(1);
  });
});

describe("the official fixtures", () => {
  const dup = "prj_41";
  const obs: Observation[] = fixtures.scores
    .filter((s) => s.project !== dup)
    .map((s) => ({ judgeId: s.judge, projectId: s.project, score: 1 + 4 * ((s.criteria.functionality + s.criteria.quality + s.criteria.innovation) / 3 - 1) / 4 }));
  const res = normalize(obs);

  it("form one connected graph and converge", () => {
    expect(res.components).toBe(1);
    expect(res.converged).toBe(true);
    expect(res.projects).toHaveLength(40);
    expect(res.judges).toHaveLength(30);
  });
  it("give the flat judge jdg_07 a zero spread and a finite offset", () => {
    const j = res.judges.find((x) => x.judgeId === "jdg_07")!;
    expect(j.sd).toBe(0);
    expect(Number.isFinite(j.offset)).toBe(true);
  });
  it("adjust gently: the normalized ranking stays close to raw", () => {
    const rho = spearman(ranking(res, "score"), ranking(res, "raw"))!;
    expect(rho).toBeGreaterThan(0.9);
    expect(rho).toBeLessThan(1);
  });
});

describe("rankBy", () => {
  it("gives tied projects the same rank (1, 2, 2, 4) instead of splitting them by id", () => {
    const r = rankBy([
      { id: "b", score: 4, n: 3 },
      { id: "a", score: 3.5, n: 3 },
      { id: "z", score: 3.5, n: 3 },
      { id: "c", score: 3, n: 3 },
    ]);
    expect([...r.entries()].sort()).toEqual([["a", 2], ["b", 1], ["c", 4], ["z", 2]]);
  });

  it("still separates equal scores backed by different numbers of reviews", () => {
    const r = rankBy([{ id: "few", score: 4, n: 2 }, { id: "many", score: 4, n: 5 }]);
    expect(r.get("many")).toBe(1);
    expect(r.get("few")).toBe(2);
  });
});
