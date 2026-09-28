// Profiles, handles, password changes and sessions.
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { api, makeEvent, makeTeamWithProject, makeUser, prisma } from "./helpers";
import { hashPassword } from "../../src/auth/password";
import { sha256 } from "../../src/lib/crypto";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("public profiles", () => {
  it("show history from public events only, and never the email", async () => {
    const ctx = await makeEvent();
    const { member, project } = await makeTeamWithProject(ctx.event.id, ctx.trackA.id, "Kestrel");
    const hidden = await makeEvent();
    await prisma.eventRole.create({ data: { eventId: hidden.event.id, userId: member.id, role: "judge" } });
    await prisma.event.update({ where: { id: hidden.event.id }, data: { publishedAt: null } });

    const r = await api().get(`/api/users/${member.id}`);
    expect(r.status).toBe(200);
    expect(r.body.user.handle).toMatch(/^[a-z0-9-]{3,30}$/);
    expect(JSON.stringify(r.body)).not.toContain(member.email);
    expect(r.body.history).toHaveLength(1);
    expect(r.body.history[0]).toMatchObject({ event: { slug: ctx.event.slug }, roles: ["participant"], project: { id: project.id, title: "Kestrel" } });
    expect((await api().get(`/api/users/${r.body.user.handle}`)).body.user.id).toBe(member.id);
    expect((await api().get("/api/users/no-such-person")).status).toBe(404);
  });

  it("lets you edit your profile, with unique, well-formed handles", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const handle = `kay-${randomUUID().slice(0, 6)}`;
    const ok = await api().patch("/api/me/profile").set("Cookie", a.cookie).send({ handle, headline: "Rust and robots", skills: ["Rust", "Rust", "ROS"], githubUrl: "https://github.com/kay" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.profile).toMatchObject({ handle, headline: "Rust and robots", skills: ["Rust", "ROS"] });
    expect((await api().patch("/api/me/profile").set("Cookie", b.cookie).send({ handle })).body.error.code).toBe("handle_taken");
    for (const bad of ["ab", "Has Caps", "-dash", "admin"]) expect((await api().patch("/api/me/profile").set("Cookie", b.cookie).send({ handle: bad })).status, bad).toBe(400);
    expect((await api().patch("/api/me/profile").set("Cookie", b.cookie).send({ githubUrl: "https://evil.example.org/kay" })).status).toBe(400);
    expect((await api().patch("/api/me/profile").send({ headline: "x" })).status).toBe(401);
  });
});

describe("password and sessions", () => {
  it("needs the current password, and signs out every other session", async () => {
    const u = await makeUser();
    await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword("old-password-1") } });
    const other = `other-${randomUUID()}`;
    await prisma.session.create({ data: { tokenHash: sha256(other), userId: u.id, expiresAt: new Date(Date.now() + 3_600_000) } });

    expect((await api().post("/api/me/password").set("Cookie", u.cookie).send({ current: "wrong", next: "new-password-1" })).body.error.code).toBe("wrong_password");
    expect((await api().post("/api/me/password").set("Cookie", u.cookie).send({ current: "old-password-1", next: "short" })).status).toBe(400);
    expect((await api().post("/api/me/password").set("Cookie", u.cookie).send({ current: "old-password-1", next: "new-password-1" })).status).toBe(200);

    expect((await api().get("/api/auth/me").set("Cookie", `sid=${other}`)).body.user).toBeNull();
    expect((await api().get("/api/auth/me").set("Cookie", u.cookie)).body.user.id).toBe(u.id);
    const login = await api().post("/api/auth/login").send({ email: u.email, password: "new-password-1" });
    expect(login.status).toBe(200);
  });

  it("lists sessions and signs out the others on request", async () => {
    const u = await makeUser();
    await prisma.session.create({ data: { tokenHash: sha256(`x-${randomUUID()}`), userId: u.id, expiresAt: new Date(Date.now() + 3_600_000) } });
    const list = await api().get("/api/me/sessions").set("Cookie", u.cookie);
    expect(list.body.sessions).toHaveLength(2);
    expect(list.body.sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    expect((await api().post("/api/me/sessions/revoke-others").set("Cookie", u.cookie)).body.signedOut).toBe(1);
  });
});
