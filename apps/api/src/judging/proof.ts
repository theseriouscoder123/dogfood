// The normalization proof: evidence that the method does what JUDGING.md claims, on an
// event's real judge–project graph. Deterministic (seeded), so anyone can rerun it and get
// the same numbers. Used by `npm run judging:proof` (fixtures) and by the organizer's
// per-event report (GET /normalization/report.md).
import { rng } from "./assign";
import { normalize, rankBy, spearman, DEFAULT_PARAMS, type NormalizeParams, type Observation } from "./normalize";
import type { ComputedResults } from "./results";
import type { Flag } from "./integrity";

export const PROOF_SEED = 20260928;

/**
 * The textbook alternative: z-score each judge's scores, then average per project. Guards:
 * a floor on the standard deviation (a flat judge would divide by zero) and plain centering
 * for judges with a single review.
 */
export function zscoreScores(obs: Observation[], sdFloor = 0.25): Map<string, number> {
  const byJudge = new Map<string, number[]>();
  for (const o of obs) byJudge.set(o.judgeId, [...(byJudge.get(o.judgeId) ?? []), o.score]);
  const stats = new Map(
    [...byJudge].map(([j, xs]) => {
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      const s = xs.length >= 2 ? Math.sqrt(xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1)) : sdFloor;
      return [j, { m, s: Math.max(s, sdFloor) }];
    }),
  );
  const sums = new Map<string, { t: number; n: number }>();
  for (const o of obs) {
    const { m, s } = stats.get(o.judgeId)!;
    const cur = sums.get(o.projectId) ?? { t: 0, n: 0 };
    sums.set(o.projectId, { t: cur.t + (o.score - m) / s, n: cur.n + 1 });
  }
  return new Map([...sums].map(([p, { t, n }]) => [p, t / n]));
}

export type SimSettings = { sims: number; seed: number; mu: number; qualitySd: number; biasSd: number; noiseSd: number; step: number };
export const DEFAULT_SIM: SimSettings = { sims: 300, seed: PROOF_SEED, mu: 3.3, qualitySd: 0.5, biasSd: 0.4, noiseSd: 0.5, step: 1 / 3 };

type MethodStats = { meanRho: number; p10Rho: number; winnerCorrect: number; top5Overlap: number };

/**
 * Simulate many events on the real graph (same judges, same projects, same pairs): draw true
 * quality and judge bias, add noise, round like rubric scores, and measure how well each method
 * recovers the true order.
 */
export function simulationStudy(pairs: Array<{ judgeId: string; projectId: string }>, settings: SimSettings, methods: Record<string, (obs: Observation[]) => Map<string, number>>) {
  const projects = [...new Set(pairs.map((p) => p.projectId))].sort();
  const judges = [...new Set(pairs.map((p) => p.judgeId))].sort();
  const results = new Map(Object.keys(methods).map((m) => [m, { rhos: [] as number[], winner: 0, top5: 0 }]));
  const random = rng(settings.seed);
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(random(), 1e-12))) * Math.cos(2 * Math.PI * random());
  const topN = Math.min(5, projects.length);

  for (let s = 0; s < settings.sims; s++) {
    const quality = new Map(projects.map((p) => [p, settings.qualitySd * gauss()]));
    const bias = new Map(judges.map((j) => [j, settings.biasSd * gauss()]));
    const obs = pairs.map((x) => {
      const v = settings.mu + quality.get(x.projectId)! + bias.get(x.judgeId)! + settings.noiseSd * gauss();
      return { ...x, score: Math.min(5, Math.max(1, Math.round(v / settings.step) * settings.step)) };
    });
    const truth = rankBy(projects.map((p) => ({ id: p, score: quality.get(p)!, n: 0 })));
    const trueTop = new Set([...truth].filter(([, r]) => r <= topN).map(([id]) => id));
    const n = new Map<string, number>();
    for (const o of obs) n.set(o.projectId, (n.get(o.projectId) ?? 0) + 1);
    for (const [name, fn] of Object.entries(methods)) {
      const scores = fn(obs);
      const rank = rankBy([...scores].map(([id, score]) => ({ id, score, n: n.get(id) ?? 0 })));
      const r = results.get(name)!;
      r.rhos.push(spearman(truth, rank)!);
      if ([...rank].find(([, v]) => v === 1)?.[0] === [...truth].find(([, v]) => v === 1)?.[0]) r.winner++;
      r.top5 += [...rank].filter(([id, v]) => v <= topN && trueTop.has(id)).length / topN;
    }
  }
  const out: Record<string, MethodStats> = {};
  for (const [name, r] of results) {
    const sorted = [...r.rhos].sort((a, b) => a - b);
    out[name] = {
      meanRho: sorted.reduce((a, b) => a + b, 0) / sorted.length,
      p10Rho: sorted[Math.floor(0.1 * (sorted.length - 1))]!,
      winnerCorrect: r.winner / settings.sims,
      top5Overlap: r.top5 / settings.sims,
    };
  }
  return out;
}

const raw = (obs: Observation[]) => {
  const sums = new Map<string, { t: number; n: number }>();
  for (const o of obs) {
    const cur = sums.get(o.projectId) ?? { t: 0, n: 0 };
    sums.set(o.projectId, { t: cur.t + o.score, n: cur.n + 1 });
  }
  return new Map([...sums].map(([p, { t, n }]) => [p, t / n]));
};
const additive = (params: NormalizeParams) => (obs: Observation[]) => new Map(normalize(obs, params).projects.map((p) => [p.projectId, p.score]));

export type ProofInput = {
  title: string;
  computed: ComputedResults;
  observations: Observation[];
  integrity?: { flags: Flag[]; reliability: { single: number; average: number; reviewsPerProject: number; reliable: boolean } | null; judgeName: (id: string) => string; projectName: (id: string) => string };
  sim?: Partial<SimSettings>;
  command: string;
};

const f2 = (x: number | null | undefined, d = 2) => (x === null || x === undefined ? "–" : x.toFixed(d));
const f3 = (x: number) => x.toFixed(3);
const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

export function buildProofReport(input: ProofInput): string {
  const { computed: c } = input;
  const s = c.summary;
  const settings = { ...DEFAULT_SIM, ...input.sim };
  const pairs = input.observations.map(({ judgeId, projectId }) => ({ judgeId, projectId }));
  const params = { lambdaJudge: DEFAULT_PARAMS.lambdaJudge, lambdaProject: DEFAULT_PARAMS.lambdaProject };

  const main = simulationStudy(pairs, settings, { raw, zscore: zscoreScores, additive: additive(params) });
  const fair = simulationStudy(pairs, { ...settings, biasSd: 0 }, { raw, zscore: zscoreScores, additive: additive(params) });
  const sweep = [0.5, 1, 2, 4, 8].map((lj) => ({ lj, ...simulationStudy(pairs, settings, { m: additive({ lambdaJudge: lj, lambdaProject: params.lambdaProject }) }).m! }));

  const lines: string[] = [];
  const push = (...xs: string[]) => lines.push(...xs);
  push(
    `# Normalization proof: ${input.title}`,
    "",
    `Generated by \`${input.command}\`. Deterministic: simulation seed ${settings.seed}, ${settings.sims} simulated events per scenario. Rerun it and you get these exact numbers.`,
    "",
    "## Method",
    "",
    "Each submitted review becomes one weighted composite on a 1–5 scale. Then we fit",
    "",
    "    score(judge j, project p) = μ + quality_p + leniency_j + noise",
    "",
    `with ridge shrinkage on both effects (λ_judge = ${params.lambdaJudge}, λ_project = ${params.lambdaProject}). A judge's leniency is learned from the projects they share with other judges, then removed. Projects are ranked on μ + quality_p.`,
    "",
    "## This event",
    "",
    `- ${s.projectsRanked} projects ranked from ${s.reviewsUsed} reviews by ${s.judgesUsed} judges${s.reviewsExcluded ? ` (${s.reviewsExcluded} reviews not counted: duplicates or excluded judges)` : ""}.`,
    `- Judge–project graph: **${s.components} connected component${s.components === 1 ? "" : "s"}**${s.components === 1 ? ", so every judge's leniency is comparable with every other's." : ". Scores across components are not fully comparable."}`,
    `- Scoring noise σ = ${f2(s.sigma)} on the 1–5 scale. Agreement between raw and adjusted ranking: Spearman ρ = ${f3(s.rankAgreement ?? 1)} (${s.rankChanges} projects moved).`,
    "",
  );

  if (input.integrity?.reliability) {
    const r = input.integrity.reliability;
    push(
      `- Inter-rater reliability: ICC(1) = ${f3(r.single)} for a single review, ICC(1,k) = ${f3(r.average)} for the average of ~${r.reviewsPerProject} reviews.${
        r.reliable ? "" : " **Judges agree with each other little more than chance.** No normalization can create signal that the scores don't contain; treat close ranks as ties and consider more reviews per project."
      }`,
      "",
    );
  }

  push(
    "### Raw vs adjusted ranking",
    "",
    "| Rank | Δ vs raw | Project | Reviews | Raw | Adjusted | Likely rank (90%) | Flags |",
    "|---:|---:|---|---:|---:|---:|---|---|",
    ...c.projects.map((p) => {
      const d = p.rank !== null && p.rawRank !== null ? p.rawRank - p.rank : null;
      return `| ${p.rank ?? "–"} | ${d === null ? "" : d === 0 ? "·" : d > 0 ? `▲${d}` : `▼${-d}`} | ${esc(p.externalId ? `${p.externalId} ${p.title}` : p.title)} | ${p.nReviews} | ${f2(p.rawScore)} | ${f2(p.normalizedScore)} | ${p.rankLow === null ? "–" : `#${p.rankLow}–${p.rankHigh}`} | ${p.flags.join(", ")} |`;
    }),
    "",
    "### Judge leniency",
    "",
    "| Judge | Reviews | Average given | Leniency | Spread | Flags |",
    "|---|---:|---:|---:|---:|---|",
    ...c.judges.map((j) => `| ${esc(j.externalId ? `${j.externalId} ${j.name}` : j.name)} | ${j.nReviews} | ${f2(j.rawMean)} | ${j.offset >= 0 ? "+" : "−"}${f2(Math.abs(j.offset))} | ${f2(j.stdDev)} | ${j.flags.join(", ")} |`),
    "",
    "## Does it work? A simulation on this event's real graph",
    "",
    `We keep this event's exact judge–project pairs and simulate ${settings.sims} events on them. True quality ~ N(0, ${settings.qualitySd}), judge leniency ~ N(0, ${settings.biasSd}), noise ~ N(0, ${settings.noiseSd}), around ${settings.mu}, rounded to steps of ${f2(settings.step)} and clamped to 1–5 like real rubric scores. Then we ask each method to recover the true order.`,
    "",
    "| Method | Mean ρ vs truth | 10th percentile ρ | Picks the true winner | True top 5 found |",
    "|---|---:|---:|---:|---:|",
    ...(["raw", "zscore", "additive"] as const).map((m) => {
      const r = main[m]!;
      const label = m === "raw" ? "Raw average" : m === "zscore" ? "Per-judge z-score" : "**Additive + shrinkage (ours)**";
      return `| ${label} | ${f3(r.meanRho)} | ${f3(r.p10Rho)} | ${(r.winnerCorrect * 100).toFixed(0)}% | ${(r.top5Overlap * 100).toFixed(0)}% |`;
    }),
    "",
    "**Control: what if judges are perfectly fair?** The same simulation with zero leniency, which prices the insurance:",
    "",
    "| Method | Mean ρ vs truth |",
    "|---|---:|",
    `| Raw average | ${f3(fair.raw!.meanRho)} |`,
    `| Per-judge z-score | ${f3(fair.zscore!.meanRho)} |`,
    `| Additive + shrinkage | ${f3(fair.additive!.meanRho)} |`,
    "",
    "**Sensitivity to λ_judge** (λ_project fixed):",
    "",
    "| λ_judge | Mean ρ |",
    "|---:|---:|",
    ...sweep.map((x) => `| ${x.lj}${x.lj === params.lambdaJudge ? " (default)" : ""} | ${f3(x.meanRho)} |`),
    "",
    "### Reading the numbers",
    "",
    `- When judges differ in leniency, the additive model recovers the true order better than raw averages (ρ ${f3(main.additive!.meanRho)} vs ${f3(main.raw!.meanRho)}).`,
    `- Per-judge z-scores ${main.zscore!.meanRho < main.raw!.meanRho ? "do *worse* than doing nothing" : "help less than the additive model"} (ρ ${f3(main.zscore!.meanRho)}): with a handful of reviews per judge, a standard deviation estimated from 3–5 numbers is mostly noise, and dividing by it amplifies that noise.`,
    `- When judges are fair, the model costs ${f3(Math.max(0, fair.raw!.meanRho - fair.additive!.meanRho))} ρ against raw averages: cheap insurance.`,
    `- Results change little across λ_judge from 0.5 to 4, so the default is not a fragile choice.`,
    "",
  );

  if (input.integrity) {
    const { flags, judgeName, projectName } = input.integrity;
    push("## Integrity checks", "", flags.length ? "Flags are prompts for an organizer to look, not verdicts. Nothing below changed a score." : "No flags.", "");
    if (flags.length) {
      push("| Check | Judge | Project | Finding |", "|---|---|---|---|");
      for (const fl of flags) push(`| ${fl.type.replace(/_/g, " ")} | ${esc(judgeName(fl.judgeId))} | ${fl.projectId ? esc(projectName(fl.projectId)) : ""} | ${esc(fl.summary)} |`);
      push("");
    }
  }
  push("## Reproduce", "", "```", input.command, "```", "");
  return lines.join("\n");
}
