import { describe, expect, it } from "vitest";
import { assessJudge, cumulativeSeries, elapsedFraction, median } from "../../src/judging/progress";
import { planAssignments, type AssignInput } from "../../src/judging/assign";

const H = 3_600_000;
const t0 = new Date("2026-10-01T00:00:00Z");
const at = (h: number) => new Date(t0.getTime() + h * H);

describe("elapsedFraction", () => {
  it("is the share of the window that has passed, clamped to [0, 1]", () => {
    expect(elapsedFraction(t0, at(100), at(25))).toBeCloseTo(0.25);
    expect(elapsedFraction(t0, at(100), at(-5))).toBe(0);
    expect(elapsedFraction(t0, at(100), at(150))).toBe(1);
  });
  it("is null without an end date, and handles an empty window", () => {
    expect(elapsedFraction(t0, null, at(5))).toBeNull();
    expect(elapsedFraction(t0, t0, at(1))).toBe(1);
    expect(elapsedFraction(t0, t0, at(-1))).toBe(0);
  });
});

describe("assessJudge", () => {
  const c = (active: number, submitted: number, started = submitted > 0) => ({ active, submitted, started });

  it("finished and unassigned judges are never stragglers, in any window", () => {
    for (const w of ["not_open", "open", "closed"] as const) {
      expect(assessJudge(c(4, 4), w, 0.9)).toEqual({ pace: "done", straggler: false });
      expect(assessJudge(c(0, 0), w, 0.9)).toEqual({ pace: "unassigned", straggler: false });
    }
  });
  it("before judging opens everyone is waiting", () => {
    expect(assessJudge(c(4, 0), "not_open", 0)).toEqual({ pace: "waiting", straggler: false });
  });
  it("after judging closes anyone who still owes reviews missed it", () => {
    expect(assessJudge(c(4, 3), "closed", 1)).toEqual({ pace: "missed", straggler: true });
  });
  it("not starting is fine early on and a problem after a fifth of the window", () => {
    expect(assessJudge(c(4, 0, false), "open", 0.1)).toEqual({ pace: "not_started", straggler: false });
    expect(assessJudge(c(4, 0, false), "open", 0.2)).toEqual({ pace: "not_started", straggler: true });
    expect(assessJudge(c(4, 0, false), "open", null)).toEqual({ pace: "not_started", straggler: false });
  });
  it("behind means more than 20 points under a steady pace", () => {
    // 1 of 4 = 25% done. Steady pace at 40% elapsed → on track; at 50% → behind.
    expect(assessJudge(c(4, 1), "open", 0.4).pace).toBe("on_track");
    expect(assessJudge(c(4, 1), "open", 0.46)).toEqual({ pace: "behind", straggler: true });
    // Started (a draft) but nothing submitted, most of the window gone.
    expect(assessJudge(c(4, 0, true), "open", 0.6).pace).toBe("behind");
    // Without a deadline there is no pace to fall behind.
    expect(assessJudge(c(4, 0, true), "open", null).pace).toBe("on_track");
  });
});

describe("cumulativeSeries", () => {
  it("counts events at or before each point, evenly spaced from start to end", () => {
    const s = cumulativeSeries([at(1), at(1), at(5), at(9.5)], t0, at(10), 11);
    expect(s).toHaveLength(11);
    expect(s[0]).toEqual({ t: t0.toISOString(), n: 0 });
    expect(s.map((p) => p.n)).toEqual([0, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4]);
  });
  it("counts earlier events from the start and ignores later ones", () => {
    const s = cumulativeSeries([at(-3), at(20)], t0, at(10), 3);
    expect(s.map((p) => p.n)).toEqual([1, 1, 1]);
  });
  it("is monotone and never exceeds the input", () => {
    const times = Array.from({ length: 50 }, (_, i) => at((i * 7) % 48));
    const s = cumulativeSeries(times, t0, at(48), 30);
    for (let i = 1; i < s.length; i++) expect(s[i]!.n).toBeGreaterThanOrEqual(s[i - 1]!.n);
    expect(s.at(-1)!.n).toBe(50);
  });
});

describe("median", () => {
  it("handles odd, even and empty inputs", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("planAssignments with onlyProjects (redistribution)", () => {
  // Six projects, four judges, everyone already has work. j0 drops out: their projects p0 and
  // p1 are released and must go to the others without touching any other project.
  const base: AssignInput = {
    projects: Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, trackId: null, teamId: `t${i}` })),
    judges: ["j1", "j2", "j3"].map((id) => ({ id, trackIds: [] })),
    existing: [
      { judgeId: "j1", projectId: "p0" }, { judgeId: "j2", projectId: "p1" },
      { judgeId: "j1", projectId: "p2" }, { judgeId: "j2", projectId: "p2" },
      { judgeId: "j2", projectId: "p3" }, { judgeId: "j3", projectId: "p3" },
      { judgeId: "j3", projectId: "p4" }, { judgeId: "j1", projectId: "p5" },
    ],
    blocked: [],
    conflicts: [{ judgeId: "j3", teamId: "t0" }],
    reviewsPerProject: 2,
    maxPerJudge: null,
    seed: 7,
    onlyProjects: ["p0", "p1"],
  };

  it("fills only the released projects, up to the target", () => {
    const plan = planAssignments(base);
    expect(new Set(plan.assignments.map((a) => a.projectId))).toEqual(new Set(["p0", "p1"]));
    expect(plan.assignments.filter((a) => a.projectId === "p0")).toHaveLength(1);
    expect(plan.assignments.filter((a) => a.projectId === "p1")).toHaveLength(1);
    expect(plan.shortfalls).toEqual([]);
  });
  it("still respects conflicts, and counts load from projects it doesn't fill", () => {
    const plan = planAssignments(base);
    // p0: j1 is already on it, j3 has a conflict with t0 → only j2 can take it.
    expect(plan.assignments.find((a) => a.projectId === "p0")!.judgeId).toBe("j2");
    // Load before includes the untouched projects p2..p5.
    expect(plan.loadBefore).toEqual({ j1: 3, j2: 3, j3: 2 });
  });
  it("reports shortfalls only for the released projects", () => {
    const plan = planAssignments({ ...base, reviewsPerProject: 4 });
    expect(plan.shortfalls.map((s) => s.projectId).sort()).toEqual(["p0", "p1"]);
  });
});
