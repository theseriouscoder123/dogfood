import { describe, expect, it } from "vitest";
import { commentTone, integrityFlags, reliability, type IntegrityReview } from "../../src/judging/integrity";
import { normalize } from "../../src/judging/normalize";
import { rng } from "../../src/judging/assign";
import fixtures from "../../../../data/fixtures.json";

const run = (reviews: IntegrityReview[]) =>
  integrityFlags(reviews, normalize(reviews.map((r) => ({ judgeId: r.judgeId, projectId: r.projectId, score: r.composite })), { lambdaJudge: 2, lambdaProject: 0.5 }));

/** A healthy event: 12 projects, 6 judges, 3 reviews each, modest noise, varied comments. */
function healthy(seed = 1): IntegrityReview[] {
  const r = rng(seed);
  const out: IntegrityReview[] = [];
  for (let p = 0; p < 12; p++) {
    const q = 2 + (p % 6) * 0.5;
    for (let i = 0; i < 3; i++) {
      const j = (p + i * 2) % 6;
      const v = [0, 1, 2].map(() => Math.max(1, Math.min(5, Math.round(q + 0.25 + (r() - 0.5) * 1.6))));
      out.push({ reviewId: `r${p}-${j}`, judgeId: `j${j}`, projectId: `p${p}`, values: v, composite: v.reduce((a, b) => a + b) / 3, comment: `Review ${p}/${j}`, secondsToSubmit: 300 + r() * 600 });
    }
  }
  return out;
}

describe("commentTone", () => {
  it("reads negative, positive, mixed and unrecognised comments", () => {
    expect(commentTone("Docs are thin.")).toBe("negative");
    expect(commentTone("Didn't run for me")).toBe("negative");
    expect(commentTone("Impressive and polished")).toBe("positive");
    expect(commentTone("Great idea but it crashed on start")).toBe("mixed");
    expect(commentTone("Solid.")).toBeNull();
    expect(commentTone("")).toBeNull();
  });
  it("treats a negated compliment as negative", () => {
    expect(commentTone("Not great, honestly")).toBe("negative");
    expect(commentTone("It isn't very polished")).toBe("negative");
  });
});

describe("integrityFlags", () => {
  it("raises nothing on a healthy event", () => {
    expect(run(healthy())).toEqual([]);
  });

  it("flags a comment that contradicts its score, both ways", () => {
    const reviews = healthy();
    reviews[0] = { ...reviews[0]!, values: [5, 5, 4], composite: 4.67, comment: "Docs are thin and it didn't run." };
    reviews[1] = { ...reviews[1]!, values: [1, 2, 1], composite: 1.33, comment: "Excellent work, loved it" };
    const types = run(reviews).filter((f) => f.type === "comment_mismatch").map((f) => f.reviewId);
    expect(types).toEqual(expect.arrayContaining([reviews[0]!.reviewId, reviews[1]!.reviewId]));
  });

  it("flags a review far from what the model predicts", () => {
    const reviews = healthy();
    const target = reviews.find((r) => r.projectId === "p5")!; // a strong project
    Object.assign(target, { values: [1, 1, 1], composite: 1 });
    const outliers = run(reviews).filter((f) => f.type === "outlier");
    expect(outliers.map((f) => f.reviewId)).toContain(target.reviewId);
    expect((outliers.find((f) => f.reviewId === target.reviewId)!.evidence.z as number)).toBeLessThan(-2.5);
  });

  it("flags a judge who scores every criterion the same, and one whose scores never vary", () => {
    const reviews = healthy().map((r) => (r.judgeId === "j0" ? { ...r, values: [4, 4, 4], composite: 4 } : r));
    const flags = run(reviews).filter((f) => f.judgeId === "j0").map((f) => f.type);
    expect(flags).toEqual(expect.arrayContaining(["identical_criteria", "low_discrimination"]));
  });

  it("flags a judge who scores opposite to the panel", () => {
    const reviews = healthy().map((r) => (r.judgeId === "j1" ? { ...r, composite: 6 - r.composite, values: r.values.map((v) => 6 - v) } : r));
    const f = run(reviews).find((x) => x.type === "disagrees_with_panel");
    expect(f?.judgeId).toBe("j1");
    expect(f!.evidence.correlation as number).toBeLessThan(-0.3);
  });

  it("flags rushed reviews and a judge who is consistently fast, but not when timing is unknown", () => {
    const reviews = healthy().map((r) => (r.judgeId === "j2" ? { ...r, secondsToSubmit: 40 } : r));
    const flags = run(reviews).filter((f) => f.judgeId === "j2");
    expect(flags.filter((f) => f.type === "rushed").length).toBe(reviews.filter((r) => r.judgeId === "j2").length);
    expect(flags.some((f) => f.type === "fast_reviewer")).toBe(true);
    expect(run(healthy().map((r) => ({ ...r, secondsToSubmit: null })))).toEqual([]);
  });

  it("flags the same long comment pasted onto several projects, but not short stock phrases", () => {
    const pasted = "Nice work overall, but the README needs more detail.";
    const reviews = healthy().map((r) => (r.judgeId === "j3" ? { ...r, comment: pasted } : r.judgeId === "j4" ? { ...r, comment: "Solid." } : r));
    const flags = run(reviews).filter((f) => f.type === "copy_paste");
    expect(flags.map((f) => f.judgeId)).toEqual(["j3"]);
  });

  it("uses stable keys, so an organizer's decision survives recomputation", () => {
    const reviews = healthy();
    reviews[0] = { ...reviews[0]!, values: [5, 5, 5], composite: 5, comment: "Docs are thin." };
    expect(run(reviews).map((f) => f.key)).toEqual(run([...reviews].reverse()).map((f) => f.key));
  });
});

describe("reliability", () => {
  it("is high when judges agree and zero when scores are noise", () => {
    const agree = healthy().map((r) => ({ projectId: r.projectId, composite: 1 + Number(r.projectId.slice(1)) * 0.3 + (r.judgeId === "j0" ? 0.1 : 0) }));
    expect(reliability(agree)!.average).toBeGreaterThan(0.9);
    const random = rng(4);
    const noise = healthy().map((r) => ({ projectId: r.projectId, composite: 1 + random() * 4 }));
    expect(reliability(noise)!.average).toBeLessThan(0.5);
  });
});

describe("the official fixtures", () => {
  const reviews: IntegrityReview[] = fixtures.scores
    .filter((s) => s.project !== "prj_41")
    .map((s, i) => {
      const v = [s.criteria.functionality, s.criteria.quality, s.criteria.innovation];
      return { reviewId: `r${i}`, judgeId: s.judge, projectId: s.project, values: v, composite: (v[0]! + v[1]! + v[2]!) / 3, comment: s.comment ?? "", secondsToSubmit: null };
    });
  const flags = run(reviews);
  const has = (type: string, judge: string, project?: string) => flags.some((f) => f.type === type && f.judgeId === judge && (!project || f.projectId === project));

  it("find the cases the dataset hides", () => {
    expect(has("comment_mismatch", "jdg_15", "prj_34")).toBe(true); // 5/5/5 and "Docs are thin."
    expect(has("identical_criteria", "jdg_07")).toBe(true); // 4/4/4 three times
    expect(has("low_discrimination", "jdg_07")).toBe(true);
    expect(has("outlier", "jdg_04", "prj_37")).toBe(true);
    expect(has("disagrees_with_panel", "jdg_04")).toBe(true);
  });
  it("don't flag single-review judges as outliers or stock phrases as copy-paste", () => {
    expect(flags.some((f) => f.type === "outlier" && f.judgeId === "jdg_01")).toBe(false);
    expect(flags.some((f) => f.type === "copy_paste")).toBe(false);
  });
  it("show that the fixture judges barely agree with each other", () => {
    expect(reliability(reviews)).toMatchObject({ reliable: false });
  });
});
