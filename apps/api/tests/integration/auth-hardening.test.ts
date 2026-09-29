// Sign-in throttling, and which client address the API believes.
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { api, makeEvent, prisma } from "./helpers";
import { LOGIN_FAILURES_PER_EMAIL } from "../../src/routes/auth";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("signing in", () => {
  it("locks an account's sign-in after repeated wrong passwords, without affecting anyone else", async () => {
    const email = `brute-${randomUUID().slice(0, 8)}@test.local`;
    const other = `other-${randomUUID().slice(0, 8)}@test.local`;
    for (const e of [email, other]) expect((await api().post("/api/auth/register").send({ email: e, name: "Target", password: "correct horse battery" })).status).toBe(201);

    // A different network for each account, so only the per-account limit is in play.
    const login = (e: string, password: string, ip: string) => api().post("/api/auth/login").set("X-Forwarded-For", ip).send({ email: e, password });
    for (let i = 0; i < LOGIN_FAILURES_PER_EMAIL; i++) expect((await login(email, `guess-${i}`, "198.51.100.1")).status).toBe(401);
    const locked = await login(email, "correct horse battery", "198.51.100.1");
    expect(locked.status).toBe(429); // even the right password waits: otherwise guessing just continues
    expect(locked.body.error.code).toBe("too_many_attempts");
    expect(Number(locked.headers["retry-after"])).toBeGreaterThan(0);

    expect((await login(other, "correct horse battery", "198.51.100.2")).status).toBe(200);
  });
});

describe("client addresses", () => {
  it("believes only the last proxy hop, so a forged X-Forwarded-For is ignored", async () => {
    const ctx = await makeEvent();
    // The client claims 6.6.6.6; the (one trusted) proxy in front of the API appended 203.0.113.9.
    const r = await api().put(`${ctx.base}/pairwise/settings`).set("Cookie", ctx.organizer.cookie).set("X-Forwarded-For", "6.6.6.6, 203.0.113.9").send({ enabled: true });
    expect(r.status).toBe(200);
    const row = await prisma.auditLog.findFirstOrThrow({ where: { eventId: ctx.event.id, action: "pairwise.settings" } });
    expect(row.ip).toBe("203.0.113.9");
  });
});

describe("accounts created by an invitation", () => {
  it("can't be taken over by registering with the invitee's email", async () => {
    const ctx = await makeEvent();
    const email = `judge-${randomUUID().slice(0, 8)}@test.local`;
    // The organizer invites a judge who has no account yet.
    expect((await api().post(`${ctx.base}/judges`).set("Cookie", ctx.organizer.cookie).send({ email, sendEmail: false })).status).toBe(201);

    // Someone who only knows the address tries to register with it.
    const r = await api().post("/api/auth/register").send({ email, name: "Impostor", password: "attacker-password" });
    expect(r.status).toBe(202);
    expect(r.body.pending).toBe(true);
    expect(r.headers["set-cookie"]).toBeUndefined(); // not signed in
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.passwordHash).toBeNull(); // the attacker's password was not set
    expect(user.name).not.toBe("Impostor");
    expect((await api().post("/api/auth/login").send({ email, password: "attacker-password" })).status).toBe(401);
    // The real owner got a one-time link instead.
    expect(await prisma.passwordReset.count({ where: { userId: user.id, usedAt: null } })).toBeGreaterThanOrEqual(1);
  });
});
