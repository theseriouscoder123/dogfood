// Head-to-head judging: the judge's flow, isolation, and the organizer's report.
import { afterAll, describe, expect, it } from "vitest";
import { api, makeEvent, makeJudge, makeReview, makeTeamWithProject, prisma } from "./helpers";
import { pairKey } from "../../src/judging/pairwise";

afterAll(async () => {
  await prisma.$disconnect();
});

async function setup() {
  const ctx = await makeEvent({ open: false }); // judging open
  const projects = [];
  for (let i = 0; i < 4; i++) projects.push((await makeTeamWithProject(ctx.event.id, ctx.trackA.id, `Entry ${i}`)).project);
  const judge = await makeJudge(ctx.event.id);
  const peer = await makeJudge(ctx.event.id);
  for (const p of projects) await makeReview(ctx.event.id, judge.id, p.id);
  await makeReview(ctx.event.id, peer.id, projects[0]!.id);
  await makeReview(ctx.event.id, peer.id, projects[1]!.id);
  const as = (cookie: string) => ({
    next: () => api().get(`${ctx.base}/judging/pairwise`).set("Cookie", cookie),
    compare: (leftId: string, rightId: string, outcome = "left") => api().post(`${ctx.base}/judging/pairwise`).set("Cookie", cookie).send({ leftId, rightId, outcome }),
  });
  return { ctx, projects, judge, peer, as };
}

describe("head-to-head judging", () => {
  it("is off until the organizer turns it on", async () => {
    const { ctx, projects, judge, as } = await setup();
    const first = await as(judge.cookie).next();
    expect(first.body).toMatchObject({ enabled: false, pair: null, done: 0 });
    expect((await as(judge.cookie).compare(projects[0]!.id, projects[1]!.id)).body.error.code).toBe("pairwise_off");

    expect((await api().put(`${ctx.base}/pairwise/settings`).set("Cookie", judge.cookie).send({ enabled: true })).status).toBe(403);
    expect((await api().put(`${ctx.base}/pairwise/settings`).set("Cookie", ctx.organizer.cookie).send({ enabled: true })).body).toEqual({ enabled: true });
    expect(await prisma.auditLog.count({ where: { eventId: ctx.event.id, action: "pairwise.settings" } })).toBe(1);
  });

  it("walks a judge through every pair of their own projects once, then stops", async () => {
    const { ctx, projects, judge, as } = await setup();
    await prisma.event.update({ where: { id: ctx.event.id }, data: { pairwiseEnabled: true } });
    const mine = new Set(projects.map((p) => p.id));
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const r = await as(judge.cookie).next();
      expect(r.body).toMatchObject({ enabled: true, done: i, suggested: 6, available: 6 });
      const { left, right } = r.body.pair;
      expect(mine.has(left.id) && mine.has(right.id)).toBe(true);
      expect(left.title).toMatch(/^Entry/);
      expect(seen.has(pairKey(left.id, right.id))).toBe(false);
      seen.add(pairKey(left.id, right.id));
      expect((await as(judge.cookie).compare(left.id, right.id, i % 3 === 0 ? "tie" : "left")).status).toBe(201);
    }
    expect((await as(judge.cookie).next()).body).toMatchObject({ done: 6, pair: null });
    // Same pair again, even the other way round: refused.
    const [a, b] = [...seen][0]!.split(":");
    expect((await as(judge.cookie).compare(b!, a!)).body.error.code).toBe("already_compared");
    expect(await prisma.auditLog.count({ where: { eventId: ctx.event.id, action: "pairwise.compared" } })).toBe(6);
  });

  it("only lets a judge compare their own live assignments, while judging is open", async () => {
    const { ctx, projects, judge, peer, as } = await setup();
    await prisma.event.update({ where: { id: ctx.event.id }, data: { pairwiseEnabled: true } });
    // The peer judge wasn't given Entry 2 or 3: not theirs looks like not there.
    expect((await as(peer.cookie).compare(projects[2]!.id, projects[3]!.id)).status).toBe(404);
    expect((await as(peer.cookie).compare(projects[0]!.id, projects[2]!.id)).status).toBe(404);
    // Organizers can't compare on a judge's behalf.
    expect((await as(ctx.organizer.cookie).compare(projects[0]!.id, projects[1]!.id)).status).toBe(403);
    expect((await as(judge.cookie).compare(projects[0]!.id, projects[0]!.id)).body.error.code).toBe("same_project");

    // After recusing, a project drops out of the judge's pairs.
    await prisma.assignment.updateMany({ where: { judgeId: judge.id, projectId: projects[3]!.id }, data: { status: "recused" } });
    expect((await as(judge.cookie).compare(projects[0]!.id, projects[3]!.id)).status).toBe(404);
    expect((await as(judge.cookie).next()).body.available).toBe(3);

    await prisma.event.update({ where: { id: ctx.event.id }, data: { judgingClosesAt: new Date(Date.now() - 1000) } });
    expect((await as(judge.cookie).compare(projects[0]!.id, projects[1]!.id)).body.error.code).toBe("judging_closed");
  });

  it("gives organizers a ranking, and the database refuses malformed pairs", async () => {
    const { ctx, projects, judge, peer, as } = await setup();
    await prisma.event.update({ where: { id: ctx.event.id }, data: { pairwiseEnabled: true } });
    // Entry 0 > 1 > 2 > 3, consistently.
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) await as(judge.cookie).compare(projects[j]!.id, projects[i]!.id, "right");
    await as(peer.cookie).compare(projects[0]!.id, projects[1]!.id, "left");

    expect((await api().get(`${ctx.base}/pairwise`).set("Cookie", judge.cookie)).status).toBe(403); // judges never see the panel's view
    const r = await api().get(`${ctx.base}/pairwise`).set("Cookie", ctx.organizer.cookie);
    expect(r.status).toBe(200);
    expect(r.body.comparisons).toBe(7);
    expect(r.body.projects.map((p: { title: string }) => p.title)).toEqual(["Entry 0", "Entry 1", "Entry 2", "Entry 3"]);
    expect(r.body.projects[0]).toMatchObject({ rank: 1, wins: 4, losses: 0, comparisons: 4 });
    expect(r.body.projects[0].rating).toBeGreaterThan(1500);
    expect(r.body.positionBias).toMatchObject({ decided: 7, leftWins: 1 });
    expect(r.body.judges.map((j: { judgeId: string }) => j.judgeId).sort()).toEqual([judge.id, peer.id].sort());

    const csv = await api().get(`${ctx.base}/export/comparisons.csv`).set("Cookie", ctx.organizer.cookie);
    expect(csv.status).toBe(200);
    expect(csv.text.trim().split("\n")).toHaveLength(8);

    await expect(
      prisma.pairwiseComparison.create({ data: { eventId: ctx.event.id, judgeId: peer.id, leftProjectId: projects[0]!.id, rightProjectId: projects[1]!.id, pairKey: "made-up", outcome: "left" } }),
    ).rejects.toThrow();
    // A judge can't be recorded comparing a project they weren't assigned (composite foreign key).
    await expect(
      prisma.pairwiseComparison.create({ data: { eventId: ctx.event.id, judgeId: peer.id, leftProjectId: projects[2]!.id, rightProjectId: projects[3]!.id, pairKey: pairKey(projects[2]!.id, projects[3]!.id), outcome: "left" } }),
    ).rejects.toThrow();
  });
});
