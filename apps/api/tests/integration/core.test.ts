// T1 end to end through the API: register, form a team, invite, draft, edit, submit, the
// public gallery, and the deadline refusing everything after it passes.
import { afterAll, describe, expect, it } from "vitest";
import { api, makeEvent, makeUser, prisma } from "./helpers";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("T1: from sign-up to the gallery", () => {
  it("teams form by invite, drafts stay private, submitted projects are public", async () => {
    const ctx = await makeEvent(); // submissions open for 24 h
    const [captain, friend] = [await makeUser({ name: "Cap Tain" }), await makeUser({ name: "Fri End" })];
    const as = (u: { cookie: string }) => ({
      get: (p: string) => api().get(`${ctx.base}${p}`).set("Cookie", u.cookie),
      post: (p: string, b?: object) => api().post(`${ctx.base}${p}`).set("Cookie", u.cookie).send(b ?? {}),
      patch: (p: string, b: object) => api().patch(`${ctx.base}${p}`).set("Cookie", u.cookie).send(b),
    });

    expect((await as(captain).post("/register")).status).toBeLessThan(300);
    expect((await as(captain).post("/teams", { name: "Night Shift" })).status).toBe(201);
    expect((await as(captain).post("/teams", { name: "Second Team" })).body.error.code).toBe("already_on_team");

    const invite = await as(captain).post("/teams/mine/invites", { maxUses: 1 });
    expect(invite.status).toBe(201);
    const accept = () => api().post(`/api/invites/${invite.body.invite.token}/accept`);
    expect((await accept()).status).toBe(401); // signed out
    expect((await accept().set("Cookie", friend.cookie)).status).toBe(201);
    const stranger = await makeUser();
    expect((await accept().set("Cookie", stranger.cookie)).body.error.code).toBe("invite_used_up");
    expect((await as(friend).get("/teams/mine")).body.team.members).toHaveLength(2);

    // A draft: visible to the team, not to the public gallery or a stranger.
    const created = await as(captain).post("/projects", { title: "Lamplighter" });
    expect(created.status).toBe(201);
    const id = created.body.project.id as string;
    expect((await api().get(`${ctx.base}/projects`)).body.projects.some((p: { id: string }) => p.id === id)).toBe(false);
    expect((await as(stranger).get(`/projects/${id}`)).status).toBe(404); // a draft isn't even confirmed to exist
    expect((await as(friend).get(`/projects/${id}`)).status).toBe(200);

    // Submitting needs the required fields; then the friend can edit it too.
    expect((await as(captain).post(`/projects/${id}/submit`)).status).toBe(422);
    expect((await as(friend).patch(`/projects/${id}`, { tagline: "Night buses, on time", description: "Arrival predictions.", repoUrl: "https://example.org/lamp", trackId: ctx.trackA.id })).status).toBe(200);
    expect((await as(captain).post(`/projects/${id}/submit`)).status).toBe(200);
    expect((await as(stranger).patch(`/projects/${id}`, { title: "Hijacked" })).status).toBe(403);

    const gallery = await api().get(`${ctx.base}/projects`);
    expect(gallery.status).toBe(200);
    expect(gallery.body.projects.find((p: { id: string }) => p.id === id)).toMatchObject({ title: "Lamplighter", tagline: "Night buses, on time" });
    // Still editable after submitting, until the deadline.
    expect((await as(friend).patch(`/projects/${id}`, { tagline: "Night buses, honestly on time" })).status).toBe(200);
  });

  it("after the deadline, the API refuses new projects, edits and status changes, and logs the attempts", async () => {
    const ctx = await makeEvent();
    const captain = await makeUser();
    await api().post(`${ctx.base}/teams`).set("Cookie", captain.cookie).send({ name: "Late Team" });
    const created = await api().post(`${ctx.base}/projects`).set("Cookie", captain.cookie).send({ title: "Almost" });
    const id = created.body.project.id as string;
    await api().patch(`${ctx.base}/projects/${id}`).set("Cookie", captain.cookie).send({ tagline: "t", description: "d", repoUrl: "https://example.org/a", trackId: ctx.trackA.id });
    expect((await api().post(`${ctx.base}/projects/${id}/submit`).set("Cookie", captain.cookie)).status).toBe(200);

    await prisma.event.update({ where: { id: ctx.event.id }, data: { submissionsCloseAt: new Date(Date.now() - 1000) } });
    const refused = [
      await api().post(`${ctx.base}/projects`).set("Cookie", captain.cookie).send({ title: "Too late" }),
      await api().patch(`${ctx.base}/projects/${id}`).set("Cookie", captain.cookie).send({ title: "Sneaky edit" }),
      await api().post(`${ctx.base}/projects/${id}/unsubmit`).set("Cookie", captain.cookie),
    ];
    for (const r of refused) {
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
    }
    expect((await prisma.project.findUniqueOrThrow({ where: { id } })).title).toBe("Almost");
    expect(await prisma.auditLog.count({ where: { eventId: ctx.event.id, action: "submission.refused_closed" } })).toBe(3);
    // The gallery stays public after the deadline.
    expect((await api().get(`${ctx.base}/projects`)).body.projects.map((p: { id: string }) => p.id)).toContain(id);
  });

  it("a team can't grow past the event's team size", async () => {
    const ctx = await makeEvent();
    await prisma.event.update({ where: { id: ctx.event.id }, data: { maxTeamSize: 2 } });
    const [a, b, c] = [await makeUser(), await makeUser(), await makeUser()];
    await api().post(`${ctx.base}/teams`).set("Cookie", a.cookie).send({ name: "Duo" });
    const invite = await api().post(`${ctx.base}/teams/mine/invites`).set("Cookie", a.cookie).send({ maxUses: 5 });
    const accept = (u: { cookie: string }) => api().post(`/api/invites/${invite.body.invite.token}/accept`).set("Cookie", u.cookie);
    expect((await accept(b)).status).toBe(201);
    expect((await accept(c)).body.error.code).toBe("invite_team_full");
  });
});
