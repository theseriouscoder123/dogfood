// T2 phase 5: normalization runs, snapshots, publishing and the public results page.
import { afterAll, describe, expect, it } from "vitest";
import { api, makeEvent, makeJudge, makeReview, makeTeamWithProject, makeUser, prisma } from "./helpers";
import { verifyAuditChain } from "../../src/audit";
import { PublishedResults } from "../../src/openapi/schemas";

afterAll(async () => {
  await prisma.$disconnect();
});

const HOUR = 3_600_000;

/**
 * Three judges (harsh, generous, neutral) score three shared anchor projects, which reveals
 * their bias. Then "Underdog" is only seen by the harsh judge and the neutral one, and
 * "Lucky" only by the generous judge and the neutral one. Raw means put Lucky first;
 * the true order is Underdog first.
 */
async function setup() {
  const ctx = await makeEvent({ open: false });
  const o = ctx.organizer.cookie;
  const c = (await api().post(`${ctx.base}/criteria`).set("Cookie", o).send({ label: "Overall", weight: 1, minScore: 1, maxScore: 9 })).body.criterion;
  const [harsh, generous, neutral] = [await makeJudge(ctx.event.id), await makeJudge(ctx.event.id), await makeJudge(ctx.event.id)];
  const p: Record<string, Awaited<ReturnType<typeof makeTeamWithProject>>> = {};
  for (const t of ["Anchor 1", "Anchor 2", "Anchor 3", "Underdog", "Lucky"]) p[t] = await makeTeamWithProject(ctx.event.id, ctx.trackA.id, t);
  const score = (judge: { id: string }, title: string, v: number) => makeReview(ctx.event.id, judge.id, p[title]!.project.id, { [c.id]: v });
  for (const [i, t] of ["Anchor 1", "Anchor 2", "Anchor 3"].entries()) {
    await score(harsh, t, 2 + i);
    await score(generous, t, 6 + i);
    await score(neutral, t, 4 + i);
  }
  await score(harsh, "Underdog", 5);
  await score(neutral, "Underdog", 7);
  await score(generous, "Lucky", 8);
  await score(neutral, "Lucky", 5);
  const close = () => prisma.event.update({ where: { id: ctx.event.id }, data: { judgingOpensAt: new Date(Date.now() - 2 * HOUR), judgingClosesAt: new Date(Date.now() - HOUR) } });
  return { ...ctx, o, c, harsh, generous, neutral, p, close };
}

type Row = { title: string; rank: number | null; rawRank: number | null; normalizedScore: number | null; flags: string[] };
const byTitle = (rows: Row[]) => Object.fromEntries(rows.map((r) => [r.title, r]));

describe("preview", () => {
  it("corrects for harsh and generous judges and flags them", async () => {
    const s = await setup();
    const res = await api().post(`${s.base}/normalization/preview`).set("Cookie", s.o).send({});
    expect(res.status).toBe(200);
    const rows = byTitle(res.body.projects);
    expect(rows.Lucky!.rawRank).toBeLessThan(rows.Underdog!.rawRank!); // raw is fooled
    expect(rows.Underdog!.rank).toBeLessThan(rows.Lucky!.rank!); // the model is not
    const flags = Object.fromEntries(res.body.judges.map((j: { judgeId: string; flags: string[] }) => [j.judgeId, j.flags]));
    expect(flags[s.harsh.id]).toContain("harsh");
    expect(flags[s.generous.id]).toContain("generous");
    expect(res.body.summary).toMatchObject({ converged: true, components: 1, reviewsUsed: 13, projectsRanked: 5 });
    expect(await prisma.normalizationRun.count({ where: { eventId: s.event.id } })).toBe(0);
  });

  it("requires a reason to exclude a judge, and drops their reviews", async () => {
    const s = await setup();
    const noReason = await api().post(`${s.base}/normalization/preview`).set("Cookie", s.o).send({ excludedJudges: [{ judgeId: s.generous.id, reason: "" }] });
    expect(noReason.status).toBe(400);
    const stranger = await makeUser();
    const notJudge = await api().post(`${s.base}/normalization/preview`).set("Cookie", s.o).send({ excludedJudges: [{ judgeId: stranger.id, reason: "not even a judge" }] });
    expect(notJudge.body.error.code).toBe("invalid_judge");
    const res = await api().post(`${s.base}/normalization/preview`).set("Cookie", s.o).send({ excludedJudges: [{ judgeId: s.generous.id, reason: "Mentored two of these teams" }] });
    expect(res.body.summary).toMatchObject({ reviewsUsed: 9, reviewsExcluded: 4 });
    const g = res.body.judges.find((j: { judgeId: string }) => j.judgeId === s.generous.id);
    expect(g.flags).toContain("excluded");
    expect(g.exclusionReason).toBe("Mentored two of these teams");
  });

  it("leaves duplicates unranked and flags projects below the review minimum", async () => {
    const s = await setup();
    await prisma.project.update({ where: { id: s.p.Lucky!.project.id }, data: { duplicateOfId: s.p.Underdog!.project.id } });
    const res = await api().post(`${s.base}/normalization/preview`).set("Cookie", s.o).send({ minReviews: 3 });
    const rows = byTitle(res.body.projects);
    expect(rows.Lucky).toMatchObject({ rank: null, flags: ["duplicate"] });
    expect(rows.Underdog!.flags).toContain("provisional"); // 2 reviews < 3
    expect(rows["Anchor 1"]!.flags).not.toContain("provisional");
  });

  it("is for organizers only", async () => {
    const s = await setup();
    const participant = s.p.Lucky!.member;
    for (const cookie of [s.harsh.cookie, participant.cookie]) {
      expect((await api().post(`${s.base}/normalization/preview`).set("Cookie", cookie).send({})).status).toBe(403);
      expect((await api().get(`${s.base}/normalization`).set("Cookie", cookie)).status).toBe(403);
    }
    expect((await api().post(`${s.base}/normalization/runs`).send({})).status).toBe(401);
  });
});

describe("runs", () => {
  it("saves exactly what the preview showed, deterministically", async () => {
    const s = await setup();
    const preview = await api().post(`${s.base}/normalization/preview`).set("Cookie", s.o).send({});
    const a = await api().post(`${s.base}/normalization/runs`).set("Cookie", s.o).send({});
    const b = await api().post(`${s.base}/normalization/runs`).set("Cookie", s.o).send({});
    expect(a.status).toBe(201);
    expect(a.body.run.inputHash).toBe(preview.body.inputHash);
    expect(b.body.run.inputHash).toBe(a.body.run.inputHash);

    const detail = await api().get(`${s.base}/normalization/runs/${a.body.run.id}`).set("Cookie", s.o);
    expect(detail.body.run).toMatchObject({ stale: false, published: false, method: "additive-ridge-v1" });
    const pick = (rows: Row[]) => rows.map((r) => [r.title, r.rank, r.normalizedScore?.toFixed(9)]);
    expect(pick(detail.body.projects)).toEqual(pick(preview.body.projects));
    const list = await api().get(`${s.base}/normalization`).set("Cookie", s.o);
    expect(list.body.runs).toHaveLength(2);
  });

  it("can never be edited or deleted, even directly in the database", async () => {
    const s = await setup();
    const { body } = await api().post(`${s.base}/normalization/runs`).set("Cookie", s.o).send({});
    const row = await prisma.projectResult.findFirstOrThrow({ where: { runId: body.run.id } });
    await expect(prisma.projectResult.update({ where: { runId_projectId: { runId: row.runId, projectId: row.projectId } }, data: { rank: 1 } })).rejects.toThrow(/immutable/);
    await expect(prisma.judgeStat.deleteMany({ where: { runId: body.run.id } })).rejects.toThrow(/immutable/);
    await expect(prisma.normalizationRun.update({ where: { id: body.run.id }, data: { method: "fudged" } })).rejects.toThrow(/immutable/);
  });

  it("goes stale when a score changes after it was computed", async () => {
    const s = await setup();
    const { body } = await api().post(`${s.base}/normalization/runs`).set("Cookie", s.o).send({});
    const review = await prisma.review.findFirstOrThrow({ where: { projectId: s.p.Lucky!.project.id, judgeId: s.neutral.id } });
    await prisma.reviewScore.update({ where: { reviewId_criterionId: { reviewId: review.id, criterionId: s.c.id } }, data: { value: 9 } });
    const detail = await api().get(`${s.base}/normalization/runs/${body.run.id}`).set("Cookie", s.o);
    expect(detail.body.run.stale).toBe(true);
  });
});

describe("publishing", () => {
  it("only after judging closes, only a current run, and the public sees a clean leaderboard", async () => {
    const s = await setup();
    const { body } = await api().post(`${s.base}/normalization/runs`).set("Cookie", s.o).send({});
    const publish = () => api().post(`${s.base}/normalization/runs/${body.run.id}/publish`).set("Cookie", s.o).send({});

    expect((await api().get(`${s.base}/results`)).body.error.code).toBe("results_not_published");
    const early = await publish();
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("judging_open");

    await s.close();
    expect((await publish()).status).toBe(200);
    const pub = await api().get(`${s.base}/results`); // anonymous
    PublishedResults.parse(pub.body); // the documented response shape (openapi/schemas.ts) holds
    expect(pub.status).toBe(200);
    expect(pub.body.results.map((r: { project: { title: string } }) => r.project.title).indexOf("Underdog")).toBeLessThan(
      pub.body.results.map((r: { project: { title: string } }) => r.project.title).indexOf("Lucky"),
    );
    const text = JSON.stringify(pub.body);
    for (const secret of [s.harsh.id, s.generous.id, "offset", "rawScore", "stdError"]) expect(text).not.toContain(secret);

    const csv = (await api().get(`${s.base}/export/results.csv`).set("Cookie", s.o)).text;
    expect(csv).toContain(`published run ${body.run.id}`);
    expect(csv.split("\r\n")[0]).toContain("normalized_score");

    expect((await api().post(`${s.base}/normalization/unpublish`).set("Cookie", s.o).send({})).status).toBe(200);
    expect((await api().get(`${s.base}/results`)).status).toBe(404);

    const actions = (await prisma.auditLog.findMany({ where: { eventId: s.event.id, action: { startsWith: "results." } }, orderBy: { id: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["results.run_created", "results.published", "results.unpublished"]);
    expect((await verifyAuditChain()).ok).toBe(true);
  });

  it("refuses a stale run", async () => {
    const s = await setup();
    const { body } = await api().post(`${s.base}/normalization/runs`).set("Cookie", s.o).send({});
    await s.close();
    await api().patch(`${s.base}/criteria/${s.c.id}`).set("Cookie", s.o).send({ weight: 3 }); // re-weighting changes the inputs
    await makeReview(s.event.id, (await makeJudge(s.event.id)).id, s.p.Lucky!.project.id, { [s.c.id]: 1 });
    const res = await api().post(`${s.base}/normalization/runs/${body.run.id}/publish`).set("Cookie", s.o).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("stale_run");
    expect((await prisma.event.findUniqueOrThrow({ where: { id: s.event.id } })).publishedRunId).toBeNull();
  });
});
