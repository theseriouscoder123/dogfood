// Properties of the assignment algorithm. Most tests generate many random events and
// check that the hard constraints hold on every one of them.
import { describe, expect, it } from "vitest";
import { planAssignments, loadStats, rng, type AssignInput } from "../../src/judging/assign";
import fixtures from "../../../../data/fixtures.json";

function randomEvent(seed: number, opts: { projects?: number; judges?: number; tracks?: number; conflicts?: number; multiTrack?: number } = {}): AssignInput {
  const r = rng(seed);
  const tracks = Array.from({ length: opts.tracks ?? 4 }, (_, i) => `t${i}`);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]!;
  const projects = Array.from({ length: opts.projects ?? 40 }, (_, i) => ({ id: `p${i}`, trackId: pick(tracks), teamId: `team${i}` }));
  const judges = Array.from({ length: opts.judges ?? 20 }, (_, i) => {
    const own = [pick(tracks)];
    if (r() < (opts.multiTrack ?? 0.3)) own.push(pick(tracks));
    return { id: `j${i}`, trackIds: [...new Set(own)] };
  });
  const conflicts = Array.from({ length: opts.conflicts ?? 5 }, () => ({ judgeId: pick(judges).id, teamId: pick(projects).teamId }));
  return { projects, judges, existing: [], blocked: [], conflicts, reviewsPerProject: 3, maxPerJudge: null, seed };
}

function checkHardConstraints(input: AssignInput, plan: ReturnType<typeof planAssignments>) {
  const judge = new Map(input.judges.map((j) => [j.id, j]));
  const project = new Map(input.projects.map((p) => [p.id, p]));
  const conflicts = new Set(input.conflicts.map((c) => `${c.judgeId}|${c.teamId}`));
  const blocked = new Set(input.blocked.map((b) => `${b.judgeId}|${b.projectId}`));
  const seen = new Set(input.existing.map((e) => `${e.judgeId}|${e.projectId}`));
  for (const a of plan.assignments) {
    const j = judge.get(a.judgeId)!, p = project.get(a.projectId)!;
    expect(j.trackIds.length === 0 || (p.trackId !== null && j.trackIds.includes(p.trackId)), "track rule").toBe(true);
    expect(conflicts.has(`${a.judgeId}|${p.teamId}`), "conflict of interest").toBe(false);
    expect(blocked.has(`${a.judgeId}|${a.projectId}`), "blocked/recused pair").toBe(false);
    expect(seen.has(`${a.judgeId}|${a.projectId}`), "duplicate pair").toBe(false);
    seen.add(`${a.judgeId}|${a.projectId}`);
  }
  if (input.maxPerJudge !== null) for (const v of Object.values(plan.loadAfter)) expect(v).toBeLessThanOrEqual(input.maxPerJudge);
}

describe("hard constraints hold on 200 random events", () => {
  it.each(Array.from({ length: 200 }, (_, i) => i + 1))("seed %i", (seed) => {
    const input = randomEvent(seed, { conflicts: 12 });
    if (seed % 3 === 0) input.maxPerJudge = 7;
    if (seed % 4 === 0) input.blocked = input.projects.slice(0, 5).map((p, i) => ({ judgeId: input.judges[i]!.id, projectId: p.id }));
    const plan = planAssignments(input);
    checkHardConstraints(input, plan);
    // Everything reported as covered really is, and every shortfall is real.
    const counts = new Map<string, number>();
    for (const a of plan.assignments) counts.set(a.projectId, (counts.get(a.projectId) ?? 0) + 1);
    for (const s of plan.shortfalls) expect(counts.get(s.projectId) ?? 0).toBe(s.have);
  });
});

describe("coverage and balance", () => {
  it("gives every project k reviews when there are enough judges", () => {
    const input = randomEvent(7, { projects: 40, judges: 24, tracks: 1, conflicts: 0 });
    const plan = planAssignments(input);
    expect(plan.shortfalls).toEqual([]);
    expect(plan.assignments).toHaveLength(120);
    expect(plan.coverage).toEqual({ 3: 40 });
  });

  it("keeps load within 1 when every judge can review every project", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const input = randomEvent(seed, { projects: 37, judges: 11, tracks: 1, conflicts: 0 });
      const s = loadStats(planAssignments(input).loadAfter);
      expect(s.max - s.min).toBeLessThanOrEqual(1);
    }
  });

  it("reports why a project can't be covered", () => {
    const input: AssignInput = {
      projects: [
        { id: "lonely", trackId: "rare", teamId: "a" },
        { id: "thin", trackId: "small", teamId: "b" },
      ],
      judges: [
        { id: "j1", trackIds: ["small"] },
        { id: "j2", trackIds: ["small"] },
      ],
      existing: [], blocked: [], conflicts: [], reviewsPerProject: 3, maxPerJudge: null, seed: 1,
    };
    const plan = planAssignments(input);
    expect(plan.shortfalls).toEqual([
      { projectId: "lonely", have: 0, need: 3, reason: "no_eligible_judges" },
      { projectId: "thin", have: 2, need: 3, reason: "not_enough_eligible_judges" },
    ]);
  });

  it("stops at the per-judge cap and says so", () => {
    const input = randomEvent(3, { projects: 20, judges: 4, tracks: 1, conflicts: 0 });
    input.maxPerJudge = 5;
    const plan = planAssignments(input);
    expect(Math.max(...Object.values(plan.loadAfter))).toBe(5);
    expect(plan.shortfalls.every((s) => s.reason === "judge_cap_reached")).toBe(true);
  });
});

describe("determinism and incrementality", () => {
  it("same seed, same plan; different seed, different plan", () => {
    const a = planAssignments(randomEvent(42));
    const b = planAssignments(randomEvent(42));
    expect(b.assignments).toEqual(a.assignments);
    const c = planAssignments({ ...randomEvent(42), seed: 43 });
    expect(c.assignments).not.toEqual(a.assignments);
  });

  it("re-running after committing adds nothing", () => {
    const input = randomEvent(9, { tracks: 2 });
    const first = planAssignments(input);
    const second = planAssignments({ ...input, existing: first.assignments });
    expect(second.assignments).toEqual([]);
    expect(second.shortfalls).toEqual(first.shortfalls);
  });

  it("only fills the gaps left by existing assignments", () => {
    const input = randomEvent(11, { tracks: 1, conflicts: 0 });
    const existing = input.projects.slice(0, 10).map((p, i) => ({ judgeId: input.judges[i % input.judges.length]!.id, projectId: p.id }));
    const plan = planAssignments({ ...input, existing });
    expect(plan.assignments).toHaveLength(40 * 3 - 10);
  });

  it("never gives a recused pair back", () => {
    const input = randomEvent(5, { projects: 3, judges: 4, tracks: 1, conflicts: 0 });
    input.blocked = [{ judgeId: "j0", projectId: "p0" }, { judgeId: "j1", projectId: "p0" }];
    const plan = planAssignments(input);
    expect(plan.assignments.filter((a) => a.projectId === "p0").map((a) => a.judgeId).sort()).toEqual(["j2", "j3"]);
  });
});

describe("on the official fixture data", () => {
  const fx = fixtures as unknown as {
    projects: Array<{ id: string; track: string; team: string }>;
    judges: Array<{ id: string; tracks: string[] }>;
    scores: Array<{ judge: string; project: string }>;
  };
  const base: AssignInput = {
    projects: fx.projects.filter((p) => p.id !== "prj_41").map((p) => ({ id: p.id, trackId: p.track, teamId: p.team })),
    judges: fx.judges.map((j) => ({ id: j.id, trackIds: j.tracks })),
    existing: [], blocked: [], conflicts: [], reviewsPerProject: 3, maxPerJudge: null, seed: 2026,
  };

  it.each([1, 2, 3, 2026, 99])("from scratch (seed %i): full coverage, one connected graph, flatter load than the fixture's", (seed) => {
    const plan = planAssignments({ ...base, seed });
    expect(plan.shortfalls).toEqual([]);
    expect(plan.components).toBe(1);
    const ours = loadStats(plan.loadAfter);
    const theirs = loadStats(Object.fromEntries(fx.judges.map((j) => [j.id, fx.scores.filter((s) => s.judge === j.id).length])));
    expect([theirs.min, theirs.max]).toEqual([1, 11]); // the fixture's own spread
    // trk_01 and trk_08 each have 6 projects and exactly 3 eligible judges, so 6 reviews each is
    // forced; +1 is the connectivity allowance. Nobody sits idle at 1.
    expect(ours.max).toBeLessThanOrEqual(7);
    expect(ours.min).toBeGreaterThanOrEqual(2);
    expect(ours.stdev).toBeLessThan(theirs.stdev * 0.7);
  });

  it("filling the fixture's gaps tops up the 8 projects that only got 2 reviews", () => {
    const existing = fx.scores.filter((s) => s.project !== "prj_41").map((s) => ({ judgeId: s.judge, projectId: s.project }));
    const plan = planAssignments({ ...base, existing });
    expect(plan.assignments.length).toBe(8);
    expect(new Set(plan.assignments.map((a) => a.projectId)).size).toBe(8);
    expect(plan.shortfalls).toEqual([]);
  });
});
