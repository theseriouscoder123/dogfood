// Head-to-head comparisons for the judging demo, so the organizer's pairwise report has
// something to show on a fresh install. Each judge (except the live demo judge, who is left
// most pairs to try) compares the pairs the real selection rule would give them. The verdict
// follows the panel's average rubric score plus a little per-judge noise, so the two methods
// mostly agree. One judge is planted as a contrarian: they pick the weaker project every time,
// which the report's agreement column should catch. Runs once; fixed seed.
import type { PrismaClient } from "@prisma/client";
import { rng } from "../judging/assign";
import { compositeScore } from "../judging/composite";
import { choosePair, pairKey, suggestedComparisons } from "../judging/pairwise";
import { DEMO_JUDGE_EMAIL, JUDGING_DEMO_SLUG } from "./judgingDemo";

export async function seedPairwiseDemo(prisma: PrismaClient) {
  const event = await prisma.event.findUnique({ where: { slug: JUDGING_DEMO_SLUG } });
  if (!event || (await prisma.pairwiseComparison.count({ where: { eventId: event.id } })) > 0) return;
  await prisma.event.update({ where: { id: event.id }, data: { pairwiseEnabled: true } });

  const [assignments, reviews, criteria, demoJudge] = await Promise.all([
    prisma.assignment.findMany({
      where: { eventId: event.id, status: { not: "recused" }, project: { status: "submitted", duplicateOfId: null } },
      orderBy: [{ judgeId: "asc" }, { projectId: "asc" }],
      select: { judgeId: true, projectId: true, judge: { select: { name: true } } },
    }),
    prisma.review.findMany({ where: { eventId: event.id, status: "submitted" }, select: { judgeId: true, projectId: true, scores: { select: { criterionId: true, value: true } } } }),
    prisma.criterion.findMany({ where: { eventId: event.id } }),
    prisma.user.findUnique({ where: { email: DEMO_JUDGE_EMAIL }, select: { id: true } }),
  ]);
  const specs = criteria.map((c) => ({ id: c.id, key: c.key, weight: Number(c.weight), minScore: c.minScore, maxScore: c.maxScore }));
  const composite = (r: (typeof reviews)[number]) => compositeScore(new Map(r.scores.map((s) => [s.criterionId, s.value])), specs);
  const panel = new Map<string, number[]>();
  for (const r of reviews) {
    const c = composite(r);
    if (c !== null) panel.set(r.projectId, [...(panel.get(r.projectId) ?? []), c]);
  }
  const consensus = (id: string) => {
    const xs = panel.get(id);
    return xs?.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 3;
  };
  const own = new Map(reviews.map((r) => [`${r.judgeId}:${r.projectId}`, composite(r)]));

  const byJudge = new Map<string, { name: string; projects: string[] }>();
  for (const a of assignments) {
    const j = byJudge.get(a.judgeId) ?? { name: a.judge.name, projects: [] };
    j.projects.push(a.projectId);
    byJudge.set(a.judgeId, j);
  }
  const judges = [...byJudge.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  const contrarian = judges.find(([id, j]) => id !== demoJudge?.id && j.projects.length >= 4)?.[0];

  const random = rng(20260929);
  const counts = new Map<string, number>();
  const rows: Array<{ eventId: string; judgeId: string; leftProjectId: string; rightProjectId: string; pairKey: string; outcome: "left" | "right" | "tie"; createdAt: Date }> = [];
  let minute = 0;
  for (const [judgeId, j] of judges) {
    const quota = judgeId === demoJudge?.id ? 1 : suggestedComparisons(j.projects.length);
    const done = new Set<string>();
    const candidates = j.projects.map((projectId) => ({ projectId, myScore: own.get(`${judgeId}:${projectId}`) ?? null }));
    for (let k = 0; k < quota; k++) {
      const pair = choosePair(judgeId, candidates, done, counts);
      if (!pair) break;
      const gap = consensus(pair.left) - consensus(pair.right) + (random() - 0.5) * 0.5;
      let outcome: "left" | "right" | "tie" = Math.abs(gap) < 0.1 ? "tie" : gap > 0 ? "left" : "right";
      if (judgeId === contrarian && outcome !== "tie") outcome = outcome === "left" ? "right" : "left";
      const key = pairKey(pair.left, pair.right);
      done.add(key);
      for (const id of [pair.left, pair.right]) counts.set(id, (counts.get(id) ?? 0) + 1);
      rows.push({ eventId: event.id, judgeId, leftProjectId: pair.left, rightProjectId: pair.right, pairKey: key, outcome, createdAt: new Date(Date.now() - (6 * 60 - minute++ * 3) * 60_000) });
    }
  }
  await prisma.pairwiseComparison.createMany({ data: rows });
  console.log(`head-to-head demo: ${rows.length} comparisons on "${event.name}"${contrarian ? `, contrarian judge: ${byJudge.get(contrarian)!.name}` : ""}`);
}
