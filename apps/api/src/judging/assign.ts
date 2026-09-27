// Judge assignment: a pure function from (projects, judges, constraints) to a plan.
// No database access here, so every property can be unit-tested directly.
//
// Hard constraints (never violated):
//   - a judge only reviews projects in their tracks (no tracks = all tracks)
//   - no judge reviews a team they have a conflict of interest with
//   - no judge–project pair twice, and a recused pair is never re-assigned
//   - optional cap on reviews per judge
//
// Soft goals, in priority order:
//   1. every project reaches k reviews (reported as a shortfall when impossible)
//   2. balanced load: only judges within 1 review of the least-loaded eligible judge are considered
//   3. connectivity: prefer a judge from a different component of the judge–project graph,
//      so judge biases stay comparable across the event (normalization needs overlap)
//   4. diversity: prefer the judge who has co-reviewed least with this project's other judges
//   5. seeded random tie-break, so the same seed always yields the same plan
//
// Reviews are assigned in rounds (everyone's 1st review, then everyone's 2nd, ...), which
// spreads load better than filling one project completely before starting the next.

export type AssignInput = {
  projects: Array<{ id: string; trackId: string | null; teamId: string }>;
  judges: Array<{ id: string; trackIds: string[] }>;
  /** Assignments that already exist and count toward coverage (not recused). */
  existing: Array<{ judgeId: string; projectId: string }>;
  /** Pairs that must never be (re)assigned, e.g. recusals. */
  blocked: Array<{ judgeId: string; projectId: string }>;
  /** Conflicts of interest as judge–team pairs. */
  conflicts: Array<{ judgeId: string; teamId: string }>;
  reviewsPerProject: number;
  maxPerJudge: number | null;
  seed: number;
};

export type Shortfall = { projectId: string; have: number; need: number; reason: "no_eligible_judges" | "not_enough_eligible_judges" | "judge_cap_reached" };

export type AssignPlan = {
  assignments: Array<{ judgeId: string; projectId: string }>;
  shortfalls: Shortfall[];
  loadBefore: Record<string, number>;
  loadAfter: Record<string, number>;
  components: number;
  coverage: Record<number, number>; // reviews per project → number of projects
};

/** mulberry32: tiny, fast, deterministic PRNG. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    let p = this.parent.get(x) ?? x;
    if (p !== x) {
      p = this.find(p);
      this.parent.set(x, p);
    }
    return p;
  }
  union(a: string, b: string) {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

const J = (id: string) => `j:${id}`;
const P = (id: string) => `p:${id}`;

export function planAssignments(input: AssignInput): AssignPlan {
  const k = input.reviewsPerProject;
  const random = rng(input.seed);
  const tieBreak = new Map<string, number>(input.judges.map((j) => [j.id, random()]));

  const conflict = new Set(input.conflicts.map((c) => `${c.judgeId}|${c.teamId}`));
  const blocked = new Set(input.blocked.map((b) => `${b.judgeId}|${b.projectId}`));
  const onProject = new Map<string, Set<string>>(input.projects.map((p) => [p.id, new Set()]));
  const load = new Map<string, number>(input.judges.map((j) => [j.id, 0]));
  const coReviews = new Map<string, number>(); // "a|b" (sorted) → projects reviewed together
  const uf = new UnionFind();
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  const link = (judgeId: string, projectId: string) => {
    const set = onProject.get(projectId)!;
    for (const other of set) coReviews.set(pairKey(judgeId, other), (coReviews.get(pairKey(judgeId, other)) ?? 0) + 1);
    set.add(judgeId);
    load.set(judgeId, (load.get(judgeId) ?? 0) + 1);
    uf.union(J(judgeId), P(projectId));
  };

  for (const e of input.existing) if (onProject.has(e.projectId) && load.has(e.judgeId)) link(e.judgeId, e.projectId);
  const loadBefore = Object.fromEntries(load);

  // Eligibility never changes during planning, so compute it once.
  const eligible = new Map<string, string[]>();
  for (const p of input.projects) {
    eligible.set(
      p.id,
      input.judges
        .filter((j) => (j.trackIds.length === 0 || (p.trackId !== null && j.trackIds.includes(p.trackId))) && !conflict.has(`${j.id}|${p.teamId}`) && !blocked.has(`${j.id}|${p.id}`))
        .map((j) => j.id),
    );
  }

  // Scarce projects first; stable seeded order among equals.
  const projectTie = new Map(input.projects.map((p) => [p.id, random()]));
  const order = [...input.projects].sort(
    (a, b) => eligible.get(a.id)!.length - eligible.get(b.id)!.length || projectTie.get(a.id)! - projectTie.get(b.id)!,
  );

  const added: Array<{ judgeId: string; projectId: string }> = [];
  for (let round = 1; round <= k; round++) {
    for (const p of order) {
      const current = onProject.get(p.id)!;
      if (current.size >= round) continue;
      const candidates = eligible
        .get(p.id)!
        .filter((j) => !current.has(j) && (input.maxPerJudge === null || load.get(j)! < input.maxPerJudge));
      if (candidates.length === 0) continue;

      const minLoad = Math.min(...candidates.map((j) => load.get(j)!));
      const projectRoot = current.size ? uf.find(P(p.id)) : null;
      const score = (j: string) => {
        const bridges = projectRoot !== null && uf.find(J(j)) !== projectRoot ? 0 : 1;
        let shared = 0;
        for (const other of current) shared += coReviews.get(pairKey(j, other)) ?? 0;
        return [bridges, shared, load.get(j)!, tieBreak.get(j)!];
      };
      const best = candidates
        .filter((j) => load.get(j)! <= minLoad + 1)
        .map((j) => ({ j, s: score(j) }))
        .sort((a, b) => a.s[0]! - b.s[0]! || a.s[1]! - b.s[1]! || a.s[2]! - b.s[2]! || a.s[3]! - b.s[3]!)[0]!.j;

      link(best, p.id);
      added.push({ judgeId: best, projectId: p.id });
    }
  }

  const components = repairConnectivity(input, added, eligible, load, random);

  const shortfalls: Shortfall[] = [];
  const coverage: Record<number, number> = {};
  for (const p of input.projects) {
    const have = onProject.get(p.id)!.size;
    coverage[have] = (coverage[have] ?? 0) + 1;
    if (have < k) {
      const pool = eligible.get(p.id)!.length;
      shortfalls.push({
        projectId: p.id,
        have,
        need: k,
        reason: pool === 0 ? "no_eligible_judges" : pool < k ? "not_enough_eligible_judges" : "judge_cap_reached",
      });
    }
  }

  return { assignments: added, shortfalls, loadBefore, loadAfter: Object.fromEntries(load), components, coverage };
}

/** Connected components of the judge–project graph, counting only nodes with at least one edge. */
export function countComponents(edges: Array<{ judgeId: string; projectId: string }>): number {
  const uf = new UnionFind();
  for (const e of edges) uf.union(J(e.judgeId), P(e.projectId));
  return new Set(edges.map((e) => uf.find(P(e.projectId)))).size;
}

/**
 * Greedy choices can leave tracks as separate islands: each track's judges only ever see each
 * other, so their biases can't be compared across islands. This pass swaps individual *new*
 * assignments to an eligible judge from another island, and keeps a swap only if the number
 * of islands goes down. Existing assignments are never touched.
 *
 * Trade-off (deliberate): the receiving judge may be at the event's current maximum load, so
 * connectivity can cost the busiest judge one extra review. Small tracks often need every one
 * of their judges on every project, which leaves the bridging judges fully booked; without this
 * allowance those tracks can never be connected and their judges' biases can't be estimated.
 * Mutates `added` and `load`; returns the final component count.
 */
function repairConnectivity(
  input: AssignInput,
  added: Array<{ judgeId: string; projectId: string }>,
  eligible: Map<string, string[]>,
  load: Map<string, number>,
  random: () => number,
): number {
  const all = () => [...input.existing.filter((e) => eligible.has(e.projectId) && load.has(e.judgeId)), ...added];
  let components = countComponents(all());
  for (let guard = 0; components > 1 && guard < 500; guard++) {
    const uf = new UnionFind();
    for (const e of all()) uf.union(J(e.judgeId), P(e.projectId));
    const onProject = new Map<string, Set<string>>();
    for (const e of all()) (onProject.get(e.projectId) ?? onProject.set(e.projectId, new Set()).get(e.projectId)!).add(e.judgeId);

    const maxLoad = Math.max(...load.values());
    const order = added.map((_, i) => i).sort(() => random() - 0.5);
    let improved = false;
    for (const i of order) {
      const { judgeId: a, projectId: p } = added[i]!;
      const root = uf.find(P(p));
      const candidates = eligible
        .get(p)!
        .filter(
          (b) =>
            b !== a &&
            !onProject.get(p)!.has(b) &&
            load.get(b)! > 0 &&
            uf.find(J(b)) !== root &&
            load.get(b)! <= maxLoad &&
            (input.maxPerJudge === null || load.get(b)! < input.maxPerJudge),
        );
      for (const b of candidates) {
        added[i] = { judgeId: b, projectId: p };
        const next = countComponents(all());
        if (next < components) {
          load.set(a, load.get(a)! - 1);
          load.set(b, load.get(b)! + 1);
          components = next;
          improved = true;
          break;
        }
        added[i] = { judgeId: a, projectId: p };
      }
      if (improved) break;
    }
    if (!improved) break;
  }
  return components;
}

export function loadStats(load: Record<string, number>) {
  const v = Object.values(load);
  if (!v.length) return { min: 0, max: 0, mean: 0, stdev: 0 };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const stdev = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  return { min: Math.min(...v), max: Math.max(...v), mean: Math.round(mean * 100) / 100, stdev: Math.round(stdev * 100) / 100 };
}
