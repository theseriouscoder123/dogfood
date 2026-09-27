// T3 phase 1: community voting through the real API and database.
import { afterAll, describe, expect, it } from "vitest";
import { api, makeEvent, makeJudge, makeTeamWithProject, makeUser, prisma } from "./helpers";
import { sha256 } from "../../src/lib/crypto";
import { verifyAuditChain } from "../../src/audit";

afterAll(async () => {
  await prisma.$disconnect();
});

const HOUR = 3_600_000;

/** Submissions closed, six projects, voting open now with 3 votes each, verified-email mode. */
async function setup(settings: Record<string, unknown> = {}) {
  const ctx = await makeEvent({ open: false });
  const o = ctx.organizer.cookie;
  const teams = [];
  for (let i = 0; i < 6; i++) teams.push(await makeTeamWithProject(ctx.event.id, ctx.trackA.id, `Entry ${i}`));
  const res = await api()
    .put(`${ctx.base}/voting/settings`)
    .set("Cookie", o)
    .send({ opensAt: ctx.event.submissionsCloseAt.toISOString(), closesAt: new Date(Date.now() + 24 * HOUR).toISOString(), mode: "email", votesPerVoter: 3, voterDomains: [], ...settings });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const projects = teams.map((t) => t.project);
  return { ...ctx, o, teams, projects };
}

async function verifiedUser(email?: string) {
  const u = await makeUser();
  const updated = await prisma.user.update({ where: { id: u.id }, data: { emailVerifiedAt: new Date(), ...(email ? { email } : {}) } });
  return { ...u, email: updated.email };
}

const ballot = (base: string, cookie: string, projectIds: string[]) => api().put(`${base}/ballot`).set("Cookie", cookie).send({ projectIds });

describe("settings", () => {
  it("validate the window, and only organizers can change them", async () => {
    const s = await setup();
    const put = (body: object, cookie = s.o) => api().put(`${s.base}/voting/settings`).set("Cookie", cookie).send({ mode: "email", votesPerVoter: 3, voterDomains: [], ...body });
    const early = await put({ opensAt: new Date(s.event.submissionsCloseAt.getTime() - HOUR).toISOString(), closesAt: new Date(Date.now() + HOUR).toISOString() });
    expect(early.body.error.code).toBe("opens_before_deadline");
    const backwards = await put({ opensAt: new Date(Date.now() + 2 * HOUR).toISOString(), closesAt: new Date(Date.now() + HOUR).toISOString() });
    expect(backwards.body.error.code).toBe("invalid_window");
    expect((await put({ opensAt: null, closesAt: null }, s.teams[0]!.member.cookie)).status).toBe(403);
    expect(await prisma.auditLog.count({ where: { eventId: s.event.id, action: "voting.settings_updated" } })).toBe(1);
  });

  it("lock how people vote once someone has voted, but dates can still move", async () => {
    const s = await setup();
    const v = await verifiedUser();
    expect((await ballot(s.base, v.cookie, [s.projects[0]!.id])).status).toBe(200);
    const base = { opensAt: s.event.submissionsCloseAt.toISOString(), closesAt: new Date(Date.now() + 48 * HOUR).toISOString(), mode: "email", voterDomains: [] };
    expect((await api().put(`${s.base}/voting/settings`).set("Cookie", s.o).send({ ...base, votesPerVoter: 5 })).body.error.code).toBe("voting_locked");
    expect((await api().put(`${s.base}/voting/settings`).set("Cookie", s.o).send({ ...base, votesPerVoter: 3 })).status).toBe(200);
  });
});

describe("verified-email voting", () => {
  it("sign-in links are single-use, expire, and never redirect off-site", async () => {
    const s = await setup();
    const email = `new-voter-${Date.now()}@example.org`;
    expect((await api().post("/api/auth/link").send({ email, next: `/events/${s.event.slug}/vote` })).body).toEqual({ ok: true });
    expect((await prisma.loginLink.findFirstOrThrow({ where: { email } })).next).toBe(`/events/${s.event.slug}/vote`);
    await api().post("/api/auth/link").send({ email, next: "//evil.example/steal" });
    expect((await prisma.loginLink.findMany({ where: { email }, orderBy: { createdAt: "desc" } }))[0]!.next).toBe("/");

    const token = "test-token-" + Date.now();
    await prisma.loginLink.create({ data: { email, tokenHash: sha256(token), next: `/events/${s.event.slug}/vote`, expiresAt: new Date(Date.now() + HOUR) } });
    const ok = await api().post("/api/auth/link/verify").send({ token });
    expect(ok.status).toBe(200);
    expect(ok.body.next).toBe(`/events/${s.event.slug}/vote`);
    expect(ok.headers["set-cookie"]?.[0]).toMatch(/^sid=/);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(user.passwordHash).toBeNull();
    expect((await api().post("/api/auth/link/verify").send({ token })).body.error.code).toBe("invalid_link");

    const expired = "expired-" + Date.now();
    await prisma.loginLink.create({ data: { email, tokenHash: sha256(expired), expiresAt: new Date(Date.now() - 1000) } });
    expect((await api().post("/api/auth/link/verify").send({ token: expired })).body.error.code).toBe("invalid_link");
  });

  it("stops sending after five links an hour for one inbox, without saying so", async () => {
    const email = `spam-${Date.now()}@example.org`;
    for (let i = 0; i < 7; i++) expect((await api().post("/api/auth/link").send({ email })).body).toEqual({ ok: true });
    expect(await prisma.loginLink.count({ where: { email } })).toBe(5);
  });

  it("an unverified account must confirm its email first", async () => {
    const s = await setup();
    const u = await makeUser();
    expect((await api().get(`${s.base}/vote`).set("Cookie", u.cookie)).body).toMatchObject({ status: "email_unverified", projects: [] });
    expect((await ballot(s.base, u.cookie, [s.projects[0]!.id])).body.error.code).toBe("email_unverified");
    expect((await api().get(`${s.base}/vote`)).body.status).toBe("unauthenticated");
  });
});

describe("the ballot", () => {
  it("each voter gets their own stable random order", async () => {
    const s = await setup();
    const [a, b] = [await verifiedUser(), await verifiedUser()];
    const order = async (cookie: string) => ((await api().get(`${s.base}/vote`).set("Cookie", cookie)).body.projects as Array<{ id: string; position: number }>).map((p) => p.id);
    const first = await order(a.cookie);
    expect(first).toHaveLength(6);
    expect(await order(a.cookie)).toEqual(first);
    expect(await order(b.cookie)).not.toEqual(first);
  });

  it("saves up to the limit, keeps one receipt across changes, and records where each pick was shown", async () => {
    const s = await setup();
    const v = await verifiedUser();
    const [p0, p1, p2, p3] = s.projects.map((p) => p.id);
    const first = await ballot(s.base, v.cookie, [p0!, p1!]);
    expect(first.status).toBe(200);
    expect(first.body.ballot.receipt).toMatch(/^DF-/);
    const second = await ballot(s.base, v.cookie, [p1!, p2!, p3!]);
    expect(second.body.ballot.receipt).toBe(first.body.ballot.receipt);
    expect(second.body.ballot.choices.sort()).toEqual([p1, p2, p3].sort());

    expect((await ballot(s.base, v.cookie, s.projects.slice(0, 4).map((p) => p.id))).body.error.code).toBe("too_many_choices");
    expect((await ballot(s.base, v.cookie, [p0!, p0!])).body.error.code).toBe("duplicate_choice");
    expect((await ballot(s.base, v.cookie, [s.event.id])).body.error.code).toBe("invalid_project");

    const shown = ((await api().get(`${s.base}/vote`).set("Cookie", v.cookie)).body.projects as Array<{ id: string; position: number }>);
    const stored = await prisma.ballotChoice.findMany({ where: { ballot: { voter: { userId: v.id } } } });
    for (const c of stored) expect(c.position).toBe(shown.find((p) => p.id === c.projectId)!.position);
  });

  it("refuses your own project, and keeps organizers and judges out", async () => {
    const s = await setup();
    const member = s.teams[0]!.member;
    await prisma.user.update({ where: { id: member.id }, data: { emailVerifiedAt: new Date() } });
    const view = await api().get(`${s.base}/vote`).set("Cookie", member.cookie);
    expect(view.body.projects.find((p: { id: string }) => p.id === s.projects[0]!.id).ownTeam).toBe(true);
    expect((await ballot(s.base, member.cookie, [s.projects[0]!.id])).body.error.code).toBe("own_project");
    expect((await ballot(s.base, member.cookie, [s.projects[1]!.id])).status).toBe(200);

    const judge = await makeJudge(s.event.id);
    await prisma.user.update({ where: { id: judge.id }, data: { emailVerifiedAt: new Date() } });
    for (const cookie of [s.o, judge.cookie]) expect((await ballot(s.base, cookie, [s.projects[1]!.id])).body.error.code).toBe("staff_cannot_vote");
  });

  it("allows one ballot per inbox, however the address is spelled", async () => {
    const s = await setup();
    const tag = Date.now();
    const a = await verifiedUser(`sam.voter${tag}+one@gmail.com`);
    const b = await verifiedUser(`samvoter${tag}@googlemail.com`);
    expect((await ballot(s.base, a.cookie, [s.projects[0]!.id])).status).toBe(200);
    expect((await api().get(`${s.base}/vote`).set("Cookie", b.cookie)).body.status).toBe("duplicate_inbox");
    expect((await ballot(s.base, b.cookie, [s.projects[1]!.id])).body.error.code).toBe("duplicate_inbox");
  });

  it("closes on time: no more changes, but you can still see your ballot and receipt", async () => {
    const s = await setup();
    const v = await verifiedUser();
    const cast = await ballot(s.base, v.cookie, [s.projects[2]!.id]);
    await prisma.event.update({ where: { id: s.event.id }, data: { votingClosesAt: new Date(Date.now() - 1000) } });
    expect((await ballot(s.base, v.cookie, [s.projects[3]!.id])).body.error.code).toBe("voting_closed");
    const view = await api().get(`${s.base}/vote`).set("Cookie", v.cookie);
    expect(view.body).toMatchObject({ window: "closed", status: "closed", ballot: { receipt: cast.body.ballot.receipt, choices: [s.projects[2]!.id] } });
  });

  it("the database refuses over-limit and cross-event choices even without the API", async () => {
    const s = await setup();
    const v = await verifiedUser();
    const cast = await ballot(s.base, v.cookie, s.projects.slice(0, 3).map((p) => p.id));
    const b = await prisma.ballot.findUniqueOrThrow({ where: { receipt: cast.body.ballot.receipt } });
    await expect(prisma.ballotChoice.create({ data: { ballotId: b.id, projectId: s.projects[4]!.id, position: 0 } })).rejects.toThrow(/more than 3/);
    const other = await makeEvent({ open: false });
    const foreign = await makeTeamWithProject(other.event.id, other.trackA.id);
    await prisma.ballotChoice.deleteMany({ where: { ballotId: b.id, projectId: s.projects[0]!.id } });
    await expect(prisma.ballotChoice.create({ data: { ballotId: b.id, projectId: foreign.project.id, position: 0 } })).rejects.toThrow(/same event/);
  });
});

describe("results stay sealed while voting is open", () => {
  it("no response to anyone contains a tally; organizers see turnout only; the audit log never records picks", async () => {
    const s = await setup();
    for (let i = 0; i < 3; i++) await ballot(s.base, (await verifiedUser()).cookie, [s.projects[0]!.id, s.projects[1]!.id]);

    const admin = await api().get(`${s.base}/voting/admin`).set("Cookie", s.o);
    expect(admin.body.turnout).toMatchObject({ voters: 3, ballots: 3, choices: 6 });
    const adminText = JSON.stringify(admin.body);
    for (const p of s.projects) expect(adminText).not.toContain(p.id);

    const outsider = await verifiedUser();
    const views = [
      await api().get(`${s.base}/vote`).set("Cookie", outsider.cookie),
      await api().get(`${s.base}/projects`),
      await api().get(`/api/events/${s.event.slug}`),
    ];
    for (const v of views) expect(JSON.stringify(v.body)).not.toMatch(/"votes"|"tally"|"voteCount"/);
    expect((await api().get(`${s.base}/vote`).set("Cookie", outsider.cookie)).body.ballot).toBeNull();

    const rows = await prisma.auditLog.findMany({ where: { eventId: s.event.id, action: { startsWith: "ballot." } } });
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.after).toEqual({ choices: 2 });
      expect(JSON.stringify([r.before, r.after, r.entityId])).not.toContain(s.projects[0]!.id);
    }
    expect((await verifyAuditChain()).ok).toBe(true);
  });
});

describe("invite codes", () => {
  it("are single-use, work without an account, can be revoked, and are the only way in", async () => {
    const s = await setup({ mode: "invite" });
    const minted = await api().post(`${s.base}/voting/invites`).set("Cookie", s.o).send({ count: 3, label: "Venue badges" });
    expect(minted.status).toBe(201);
    const [c1, c2, c3] = minted.body.codes.map((c: { code: string }) => c.code as string);
    expect(await prisma.voteInvite.count({ where: { eventId: s.event.id } })).toBe(3);
    expect(await prisma.voteInvite.findFirst({ where: { codeHash: c1 } })).toBeNull(); // stored hashed

    const redeem = await api().post(`${s.base}/vote/redeem`).send({ code: c1!.toLowerCase().replace(/-/g, " ") });
    expect(redeem.status).toBe(201);
    const cookie = (redeem.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
    expect((await api().get(`${s.base}/vote`).set("Cookie", cookie)).body.status).toBe("allow");
    expect((await ballot(s.base, cookie, [s.projects[0]!.id])).status).toBe(200);

    expect((await api().post(`${s.base}/vote/redeem`).send({ code: c1 })).body.error.code).toBe("code_used");
    expect((await api().post(`${s.base}/vote/redeem`).send({ code: "VOTE-XXXX-XXXX-XXXX" })).body.error.code).toBe("invalid_code");
    const verified = await verifiedUser();
    expect((await ballot(s.base, verified.cookie, [s.projects[1]!.id])).body.error.code).toBe("invite_required");

    expect((await api().post(`${s.base}/voting/invites/revoke`).set("Cookie", s.o).send({ label: "Venue badges" })).body.revoked).toBe(2);
    expect((await api().post(`${s.base}/vote/redeem`).send({ code: c2 })).body.error.code).toBe("invalid_code");
    expect(c3).toBeTruthy();
    expect(await prisma.auditLog.count({ where: { eventId: s.event.id, action: "vote.code_rejected" } })).toBe(3);
  });
});
