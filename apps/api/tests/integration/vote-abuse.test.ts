// T3 phase 2: anti-abuse. Throwaway inboxes, rate limits, "viewed before voted", and the
// organizer's review queue catching a planted stuffing ring.
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { api, makeEvent, makeTeamWithProject, makeUser, prisma } from "./helpers";
import { makeReceipt, normalizeEmail } from "../../src/voting/core";
import { verifyAuditChain } from "../../src/audit";
import { watchVoting } from "../../src/notifications/watch";

afterAll(async () => {
  await prisma.$disconnect();
});

const MIN = 60_000;
/** Random letters only: numbers in these test addresses would trip the numbered-address check. */
const letters = () => randomUUID().replace(/-/g, "").slice(0, 10).replace(/\d/g, (d) => "ghijklmnop"[Number(d)]!);
const HOUR = 60 * MIN;

async function setup() {
  const ctx = await makeEvent({ open: false });
  const o = ctx.organizer.cookie;
  const projects = [];
  for (let i = 0; i < 6; i++) projects.push((await makeTeamWithProject(ctx.event.id, ctx.trackA.id, `Entry ${i}`)).project);
  await api()
    .put(`${ctx.base}/voting/settings`)
    .set("Cookie", o)
    .send({ opensAt: ctx.event.submissionsCloseAt.toISOString(), closesAt: new Date(Date.now() + 24 * HOUR).toISOString(), mode: "email", votesPerVoter: 3, voterDomains: [] });
  return { ...ctx, o, projects };
}

async function verifiedUser(email?: string) {
  const u = await makeUser();
  await prisma.user.update({ where: { id: u.id }, data: { emailVerifiedAt: new Date(), ...(email ? { email } : {}) } });
  return u;
}

/** A ballot written straight to the database, with the history an attacker (or a fan) would leave. */
async function plant(eventId: string, o: { email: string; accountCreatedAt: Date; castAt: Date; ip: string; picks: string[]; viewed: string[] }) {
  const user = await prisma.user.create({ data: { email: o.email, name: o.email.split("@")[0]!, emailVerifiedAt: o.accountCreatedAt, createdAt: o.accountCreatedAt } });
  const identityKey = `user:${user.id}`;
  const voter = await prisma.voter.create({ data: { eventId, kind: "email", userId: user.id, identityKey, emailKey: normalizeEmail(o.email), ip: o.ip, createdAt: o.castAt } });
  const ballot = await prisma.ballot.create({ data: { eventId, voterId: voter.id, receipt: makeReceipt(), ip: o.ip, createdAt: o.castAt } });
  await prisma.ballotChoice.createMany({ data: o.picks.map((projectId, i) => ({ ballotId: ballot.id, projectId, position: i })) });
  if (o.viewed.length) await prisma.projectView.createMany({ data: o.viewed.map((projectId) => ({ eventId, projectId, viewerKey: identityKey })) });
  return ballot.id;
}

describe("prevention", () => {
  it("throwaway inboxes can't get a voting link or a ballot", async () => {
    const s = await setup();
    const link = await api().post("/api/auth/link").send({ email: `x${Date.now()}@mailinator.com`, next: `/events/${s.event.slug}/vote` });
    expect(link.body.error.code).toBe("disposable_email");
    // ... but a plain sign-in link for a non-voting page is not affected.
    expect((await api().post("/api/auth/link").send({ email: `y${Date.now()}@mailinator.com`, next: "/" })).status).toBe(200);

    const u = await verifiedUser(`burner${Date.now()}@yopmail.com`);
    expect((await api().get(`${s.base}/vote`).set("Cookie", u.cookie)).body.status).toBe("disposable_email");
    expect((await api().put(`${s.base}/ballot`).set("Cookie", u.cookie).send({ projectIds: [s.projects[0]!.id] })).body.error.code).toBe("disposable_email");
  });

  it("records which projects a voter opened, only while voting is open", async () => {
    const s = await setup();
    const v = await verifiedUser();
    expect((await api().get(`${s.base}/projects/${s.projects[2]!.id}`).set("Cookie", v.cookie)).status).toBe(200);
    expect(await prisma.projectView.count({ where: { projectId: s.projects[2]!.id, viewerKey: `user:${v.id}` } })).toBe(1);
    await api().get(`${s.base}/projects/${s.projects[2]!.id}`).set("Cookie", v.cookie); // once is enough
    expect(await prisma.projectView.count({ where: { projectId: s.projects[2]!.id } })).toBe(1);

    await prisma.event.update({ where: { id: s.event.id }, data: { votingClosesAt: new Date(Date.now() - 1000) } });
    await api().get(`${s.base}/projects/${s.projects[3]!.id}`).set("Cookie", v.cookie);
    expect(await prisma.projectView.count({ where: { projectId: s.projects[3]!.id } })).toBe(0);
  });

  it("rate-limits a flood of new ballots from one network, and one ballot flipped over and over", async () => {
    const s = await setup();
    // 60 ballots already cast from this test client's address in the last hour.
    for (let i = 0; i < 60; i++)
      await plant(s.event.id, { email: `flood${i}-${randomUUID().slice(0, 6)}@example.org`, accountCreatedAt: new Date(Date.now() - 2 * HOUR), castAt: new Date(Date.now() - 10 * MIN), ip: "::ffff:127.0.0.1", picks: [s.projects[0]!.id], viewed: [] });
    const newcomer = await verifiedUser();
    const refused = await api().put(`${s.base}/ballot`).set("Cookie", newcomer.cookie).send({ projectIds: [s.projects[1]!.id] });
    expect(refused.status).toBe(429);
    expect(await prisma.auditLog.count({ where: { eventId: s.event.id, action: "vote.rate_limited" } })).toBe(1);

    const s2 = await setup();
    const flipper = await verifiedUser();
    const put = (ids: string[]) => api().put(`${s2.base}/ballot`).set("Cookie", flipper.cookie).send({ projectIds: ids });
    expect((await put([s2.projects[0]!.id])).status).toBe(200);
    for (let i = 0; i < 30; i++) expect((await put([s2.projects[i % 2]!.id])).status).toBe(200);
    expect((await put([s2.projects[2]!.id])).body.error.code).toBe("too_many_changes");
  }, 60_000);
});

describe("the review queue", () => {
  /** 14 ordinary fans over a day, plus a ring of 8 numbered accounts on one /24 voting blind for Entry 5. */
  async function scenario() {
    const s = await setup();
    const now = Date.now();
    const organic: string[] = [];
    for (let i = 0; i < 14; i++) {
      const picks = [s.projects[i % 5]!.id, s.projects[(i + 2) % 5]!.id].slice(0, 1 + (i % 2));
      organic.push(
        await plant(s.event.id, {
          email: `${["ana", "ben", "cy", "dee", "eve", "flo", "gus"][i % 7]}.${["ito", "kerr", "lund"][i % 3]}${letters()}@${["gmail.com", "uni.edu"][i % 2]}`,
          accountCreatedAt: new Date(now - 30 * 24 * HOUR),
          castAt: new Date(now - 20 * HOUR + i * 80 * MIN),
          ip: `198.18.${i}.7`,
          picks,
          viewed: picks,
        }),
      );
    }
    const ring: string[] = [];
    const domain = `outlook-${letters()}.com`; // unique per scenario
    for (let i = 0; i < 8; i++)
      ring.push(
        await plant(s.event.id, {
          email: `dev.hunter${String(i + 1).padStart(2, "0")}@${domain}`,
          accountCreatedAt: new Date(now - 60 * MIN + i * 20_000 - 2 * MIN),
          castAt: new Date(now - 60 * MIN + i * 20_000),
          ip: `203.0.113.${50 + i}`,
          picks: [s.projects[5]!.id],
          viewed: [],
        }),
      );
    return { ...s, organic, ring };
  }

  it("alerts organizers once about an open high-severity incident", async () => {
    const s = await scenario();
    await watchVoting();
    await watchVoting();
    const alerts = await prisma.notification.findMany({ where: { userId: s.organizer.id, category: "organizer" } });
    expect(alerts.map((n) => n.title)).toEqual(["Suspicious voting needs a look"]);
    expect(alerts[0]!.url).toBe(`/events/${s.event.slug}/manage/vote-review`);
  }, 60_000);

  it("finds the ring as one high-severity incident naming the project it backs", async () => {
    const s = await scenario();
    const res = await api().get(`${s.base}/voting/review`).set("Cookie", s.o);
    expect(res.status).toBe(200);
    const high = res.body.incidents.filter((i: { severity: string }) => i.severity === "high");
    expect(high).toHaveLength(1);
    expect(high[0].ballotIds.sort()).toEqual([...s.ring].sort());
    expect(high[0].projects).toEqual([{ id: s.projects[5]!.id, title: "Entry 5" }]);
    expect(high[0].signals.length).toBeGreaterThanOrEqual(4);
    expect(high[0].sample[0].voter).toMatch(/^d\*\*\*\d@outlook-\w+\.com$/); // masked
    expect(JSON.stringify(res.body)).not.toMatch(/dev\.hunter\d/);
    // Nothing about the ordinary voters is flagged.
    for (const i of res.body.incidents) for (const id of i.ballotIds) expect(s.organic).not.toContain(id);
  });

  it("quarantine needs a reason, keeps the ballots, can be undone, and is audited", async () => {
    const s = await scenario();
    const incident = (await api().get(`${s.base}/voting/review`).set("Cookie", s.o)).body.incidents[0];
    const q = (body: object) => api().post(`${s.base}/voting/review/quarantine`).set("Cookie", s.o).send(body);
    expect((await q({ ballotIds: incident.ballotIds, reason: "x" })).status).toBe(400);
    expect((await q({ ballotIds: incident.ballotIds, reason: "Numbered accounts from one network voting blind", incidentKey: incident.key })).body.quarantined).toBe(8);
    expect(await prisma.ballot.count({ where: { eventId: s.event.id, status: "quarantined" } })).toBe(8);
    expect(await prisma.ballotChoice.count({ where: { ballotId: { in: s.ring } } })).toBe(8); // kept, not deleted

    const after = await api().get(`${s.base}/voting/review`).set("Cookie", s.o);
    expect(after.body.summary).toMatchObject({ quarantined: 8, open: 0 });
    expect(after.body.quarantinedBallots[0].reason).toBe("Numbered accounts from one network voting blind");

    const restored = await api().post(`${s.base}/voting/review/restore`).set("Cookie", s.o).send({ ballotIds: s.ring.slice(0, 2), reason: "These two confirmed by phone" });
    expect(restored.body.restored).toBe(2);
    const actions = (await prisma.auditLog.findMany({ where: { eventId: s.event.id, action: { startsWith: "ballots." } }, orderBy: { id: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["ballots.quarantined", "ballots.restored"]);
    expect((await verifyAuditChain()).ok).toBe(true);
  });

  it("an incident can be marked as fine (with a note) and reopened", async () => {
    const s = await scenario();
    const incident = (await api().get(`${s.base}/voting/review`).set("Cookie", s.o)).body.incidents[0];
    const resolve = (body: object) => api().post(`${s.base}/voting/review/resolve`).set("Cookie", s.o).send({ incidentKey: incident.key, ...body });
    expect((await resolve({ status: "dismissed", note: "" })).body.error.code).toBe("note_required");
    expect((await resolve({ status: "dismissed", note: "A workshop group, verified with the host" })).status).toBe(200);
    const view = await api().get(`${s.base}/voting/review`).set("Cookie", s.o);
    expect(view.body.incidents[0].resolution).toMatchObject({ status: "dismissed", note: "A workshop group, verified with the host" });
    expect(view.body.summary.open).toBe(0);
    expect((await resolve({ status: "open" })).body.resolution).toBeNull();
    expect((await api().post(`${s.base}/voting/review/resolve`).set("Cookie", s.o).send({ incidentKey: "surge:nope:0", status: "dismissed", note: "fine" })).status).toBe(404);
  });

  it("is for organizers only", async () => {
    const s = await setup();
    const v = await verifiedUser();
    expect((await api().get(`${s.base}/voting/review`).set("Cookie", v.cookie)).status).toBe(403);
    expect((await api().post(`${s.base}/voting/review/quarantine`).set("Cookie", v.cookie).send({ ballotIds: [randomUUID()], reason: "because" })).status).toBe(403);
    expect((await api().get(`${s.base}/voting/review`)).status).toBe(401);
  });
});
