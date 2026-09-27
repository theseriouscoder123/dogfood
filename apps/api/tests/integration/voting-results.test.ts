// T3 phase 4: People's Choice results, the public ballot file, receipts, and the seal.
import { afterAll, describe, expect, it } from "vitest";
import { api, makeEvent, makeTeamWithProject, makeUser, prisma } from "./helpers";
import { canonicalJson, sha256 } from "../../src/lib/crypto";
import { verifyAuditChain } from "../../src/audit";

afterAll(async () => {
  await prisma.$disconnect();
});

const HOUR = 3_600_000;

/**
 * Voting open, four projects. Five real voters (A gets 4 votes, B and C 2 each, D none), plus
 * two ballots for D that the organizer quarantines.
 */
async function setup() {
  const ctx = await makeEvent({ open: false });
  const o = ctx.organizer.cookie;
  const p = [];
  for (const t of ["Aurora", "Beacon", "Cinder", "Drift"]) p.push((await makeTeamWithProject(ctx.event.id, ctx.trackA.id, t)).project);
  await api().put(`${ctx.base}/voting/settings`).set("Cookie", o)
    .send({ opensAt: ctx.event.submissionsCloseAt.toISOString(), closesAt: new Date(Date.now() + 24 * HOUR).toISOString(), mode: "email", votesPerVoter: 2, voterDomains: [] });
  const vote = async (picks: number[]) => {
    const u = await makeUser();
    await prisma.user.update({ where: { id: u.id }, data: { emailVerifiedAt: new Date() } });
    const r = await api().put(`${ctx.base}/ballot`).set("Cookie", u.cookie).send({ projectIds: picks.map((i) => p[i]!.id) });
    expect(r.status).toBe(200);
    return r.body.ballot.receipt as string;
  };
  const receipts = [await vote([0, 1]), await vote([0, 2]), await vote([0]), await vote([0, 1]), await vote([2])];
  const bad = [await vote([3]), await vote([3])];
  const badIds = (await prisma.ballot.findMany({ where: { receipt: { in: bad } }, select: { id: true } })).map((b) => b.id);
  const q = await api().post(`${ctx.base}/voting/review/quarantine`).set("Cookie", o).send({ ballotIds: badIds, reason: "Two accounts made a minute apart, same network" });
  expect(q.body.quarantined).toBe(2);
  const close = () => prisma.event.update({ where: { id: ctx.event.id }, data: { votingClosesAt: new Date(Date.now() - 1000) } });
  return { ...ctx, o, p, receipts, bad, badIds, close };
}

describe("the seal", () => {
  it("nobody sees a count while voting is open: not the public, not organizers, not through exports", async () => {
    const s = await setup();
    expect((await api().get(`${s.base}/voting/results/preview`).set("Cookie", s.o)).body.error.code).toBe("sealed");
    expect((await api().post(`${s.base}/voting/results/publish`).set("Cookie", s.o).send({})).body.error.code).toBe("sealed");
    expect((await api().get(`${s.base}/export/ballots.csv`).set("Cookie", s.o)).body.error.code).toBe("sealed");
    for (const path of ["/voting/results", "/voting/ballots.json"]) expect((await api().get(`${s.base}${path}`)).body.error.code).toBe("results_not_published");
    expect((await api().post(`${s.base}/voting/receipt`).send({ receipt: s.receipts[0] })).status).toBe(404);
  });
});

describe("after voting closes", () => {
  it("organizers preview the count: quarantined ballots excluded, ties share a rank", async () => {
    const s = await setup();
    await s.close();
    const res = await api().get(`${s.base}/voting/results/preview`).set("Cookie", s.o);
    expect(res.status).toBe(200);
    expect(res.body.published).toBe(false);
    expect(res.body.stats).toEqual({ voters: 5, votes: 8, quarantinedBallots: 2 });
    expect(res.body.ranking.map((r: { project: { title: string }; votes: number; rank: number }) => [r.project.title, r.votes, r.rank])).toEqual([
      ["Aurora", 4, 1], ["Beacon", 2, 2], ["Cinder", 2, 2], ["Drift", 0, 4],
    ]);
    expect(res.body.positionCheck).toMatchObject({ picks: 8, enoughData: false });
    expect((await api().get(`${s.base}/voting/results/preview`).set("Cookie", (await makeUser()).cookie)).status).toBe(403);
  });

  it("publishing fixes the ballot file's fingerprint; anyone can download it and recount", async () => {
    const s = await setup();
    await s.close();
    const pub = await api().post(`${s.base}/voting/results/publish`).set("Cookie", s.o).send({});
    expect(pub.status).toBe(200);

    const results = await api().get(`${s.base}/voting/results`); // anonymous
    expect(results.body.ballotFile).toMatchObject({ sha256: pub.body.ballotsHash, matches: true, ballots: 7 });
    expect(results.body.ranking[0]).toMatchObject({ rank: 1, votes: 4, project: { title: "Aurora" } });

    const file = await api().get(`${s.base}/voting/ballots.json`);
    expect(file.headers["x-content-sha256"]).toBe(pub.body.ballotsHash);
    const { sha256: stated, ...body } = file.body;
    expect(sha256(canonicalJson(body))).toBe(stated); // the fingerprint is of exactly this content
    const text = JSON.stringify(file.body);
    for (const r of s.receipts) expect(text).not.toContain(r);
    expect(text).not.toMatch(/@|test\.local/);

    const recount = new Map<string, number>();
    for (const b of body.ballots as Array<{ status: string; picks: Array<{ projectId: string }> }>)
      if (b.status === "counted") for (const p of b.picks) recount.set(p.projectId, (recount.get(p.projectId) ?? 0) + 1);
    for (const r of results.body.ranking as Array<{ project: { id: string }; votes: number }>) expect(recount.get(r.project.id) ?? 0).toBe(r.votes);
    expect((body.ballots as Array<{ status: string }>).filter((b) => b.status === "quarantined")).toHaveLength(2);
  });

  it("voters can confirm their ballot was counted, and quarantined voters can see that too", async () => {
    const s = await setup();
    await s.close();
    await api().post(`${s.base}/voting/results/publish`).set("Cookie", s.o).send({});
    const mine = await api().post(`${s.base}/voting/receipt`).send({ receipt: s.receipts[1]!.toLowerCase() });
    expect(mine.body).toMatchObject({ found: true, status: "counted", picks: ["Aurora", "Cinder"] });
    expect((await api().post(`${s.base}/voting/receipt`).send({ receipt: s.bad[0] })).body).toMatchObject({ found: true, status: "quarantined" });
    expect((await api().post(`${s.base}/voting/receipt`).send({ receipt: "DF-NOPE0-NOPE0" })).body.found).toBe(false);
  });

  it("quarantine decisions are locked while results are public; unpublishing unlocks them, and it's all audited", async () => {
    const s = await setup();
    await s.close();
    await api().post(`${s.base}/voting/results/publish`).set("Cookie", s.o).send({});
    const restore = () => api().post(`${s.base}/voting/review/restore`).set("Cookie", s.o).send({ ballotIds: s.badIds, reason: "Verified by phone after all" });
    expect((await restore()).body.error.code).toBe("results_published");
    expect((await api().post(`${s.base}/voting/results/unpublish`).set("Cookie", s.o).send({})).status).toBe(200);
    expect((await api().get(`${s.base}/voting/results`)).status).toBe(404);
    expect((await restore()).body.restored).toBe(2);
    const republished = await api().post(`${s.base}/voting/results/publish`).set("Cookie", s.o).send({});
    expect((await api().get(`${s.base}/voting/results`)).body.ranking.find((r: { project: { title: string } }) => r.project.title === "Drift").votes).toBe(2);
    expect(republished.body.ballotsHash).not.toBeNull();

    const actions = (await prisma.auditLog.findMany({ where: { eventId: s.event.id, action: { startsWith: "voting.results" } }, orderBy: { id: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["voting.results_published", "voting.results_unpublished", "voting.results_published"]);
    expect((await verifyAuditChain()).ok).toBe(true);
  });

  it("ballots.csv opens for organizers once voting has closed", async () => {
    const s = await setup();
    await s.close();
    const csv = await api().get(`${s.base}/export/ballots.csv`).set("Cookie", s.o);
    expect(csv.status).toBe(200);
    const lines = csv.text.replace(/^﻿/, "").trimEnd().split("\r\n");
    expect(lines[0]).toBe("receipt_hash,status,quarantine_reason,project_id,project,shown_at_position");
    expect(lines).toHaveLength(1 + 10); // 8 counted picks + 2 quarantined
    for (const r of s.receipts) expect(csv.text).not.toContain(r);
  });
});
