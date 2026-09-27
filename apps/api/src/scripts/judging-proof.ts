// npm run judging:proof [path/to/fixtures.json] [out.md]
//
// Reads the fixture file directly (no database, no Docker) and writes the normalization proof:
// raw vs adjusted ranking, judge leniency, a seeded simulation study on the fixture's real
// judge–project graph, and the integrity checks. Same code paths as the running app.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { compositeScore } from "../judging/composite";
import { normalize, DEFAULT_PARAMS } from "../judging/normalize";
import { computeResults, normalizeOptions, type ResultInputs } from "../judging/results";
import { integrityFlags, reliability, type IntegrityReview } from "../judging/integrity";
import { buildProofReport } from "../judging/proof";
import { detectDuplicates } from "../seed/duplicates";

type Fixture = {
  event: { name: string };
  tracks: Array<{ id: string; name: string }>;
  judges: Array<{ id: string; name: string }>;
  teams: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; team: string; track: string; title: string; summary: string; repo_url?: string; submitted_at: string }>;
  scores: Array<{ judge: string; project: string; criteria: Record<string, number>; comment?: string }>;
};

async function main() {
  const root = path.resolve(__dirname, "../../../..");
  const fixturePath = path.resolve(process.argv[2] ?? path.join(root, "data/fixtures.json"));
  const outPath = path.resolve(process.argv[3] ?? path.join(root, "docs/normalization-proof.md"));
  const fx = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;

  // Criteria as the importer creates them: every key seen in the scores, equal weight, 1–5.
  const keys = [...new Set(fx.scores.flatMap((s) => Object.keys(s.criteria)))];
  const criteria = keys.map((key) => ({ id: key, key, weight: 1, minScore: 1, maxScore: 5 }));
  const dup = new Map(detectDuplicates(fx.projects).map((d) => [d.project.id, d.duplicateOf]));
  const team = new Map(fx.teams.map((t) => [t.id, t.name]));
  const track = new Map(fx.tracks.map((t) => [t.id, t]));

  const inputs: ResultInputs = {
    criteria,
    reviews: fx.scores.map((s, i) => ({ id: `review-${i}`, judgeId: s.judge, projectId: s.project, scores: new Map(Object.entries(s.criteria)) })),
    projects: fx.projects.map((p) => ({
      id: p.id, externalId: p.id, title: p.title, tagline: p.summary, thumbnailUrl: null, duplicateOfId: dup.get(p.id) ?? null,
      team: { name: team.get(p.team) ?? p.team }, track: track.get(p.track) ?? null,
    })),
    judges: fx.judges.map((j) => ({ id: j.id, name: j.name, externalId: j.id })),
    topK: 3,
  };
  const computed = computeResults(inputs, normalizeOptions({ minReviews: 3 }));

  const judgeable = new Set(inputs.projects.filter((p) => !p.duplicateOfId).map((p) => p.id));
  const reviews: IntegrityReview[] = fx.scores
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => judgeable.has(s.project))
    .map(({ s, i }) => ({
      reviewId: `review-${i}`, judgeId: s.judge, projectId: s.project,
      values: keys.map((k) => s.criteria[k]!), composite: compositeScore(new Map(Object.entries(s.criteria)), criteria)!,
      comment: s.comment ?? "", secondsToSubmit: null,
    }));
  const observations = reviews.map((r) => ({ judgeId: r.judgeId, projectId: r.projectId, score: r.composite }));
  const flags = integrityFlags(reviews, normalize(observations, DEFAULT_PARAMS));

  const report = buildProofReport({
    title: fx.event.name,
    computed,
    observations,
    integrity: {
      flags,
      reliability: reliability(reviews),
      judgeName: (id) => `${id} ${fx.judges.find((j) => j.id === id)?.name ?? ""}`.trim(),
      projectName: (id) => `${id} ${fx.projects.find((p) => p.id === id)?.title ?? ""}`.trim(),
    },
    command: "cd apps/api && npm run judging:proof",
  });
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, report);
  const d = dup.size ? [...dup].filter(([, v]) => v).map(([k, v]) => `${k}→${v}`).join(", ") : "none";
  console.log(`wrote ${path.relative(process.cwd(), outPath)}: ${computed.summary.projectsRanked} projects ranked, ${flags.length} integrity flags, duplicates ${d}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
