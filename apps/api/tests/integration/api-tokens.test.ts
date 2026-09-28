// T4 phase 1: personal API tokens and the OpenAPI document.
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { api, makeEvent, makeJudge, makeTeamWithProject, makeUser, prisma, type TestUser } from "./helpers";
import { verifyAuditChain } from "../../src/audit";
import { sha256 } from "../../src/lib/crypto";
import { OPERATIONS } from "../../src/openapi/operations";
import * as S from "../../src/openapi/schemas";

afterAll(async () => {
  await prisma.$disconnect();
});

async function createToken(user: TestUser, body: Record<string, unknown> = { name: "CI export", scopes: ["read"] }) {
  const r = await api().post("/api/auth/tokens").set("Cookie", user.cookie).send(body);
  expect(r.status).toBe(201);
  S.TokenCreated.parse(r.body);
  return { id: r.body.token.id as string, secret: r.body.secret as string, body: r.body };
}

const bearer = (secret: string) => ({ Authorization: `Bearer ${secret}` });

describe("creating tokens", () => {
  it("returns the secret once and stores only its hash", async () => {
    const u = await makeUser();
    const { id, secret, body } = await createToken(u, { name: "  Results sync  ", scopes: ["read"], expiresInDays: 30 });
    expect(secret).toMatch(/^dfp_[A-Za-z0-9_-]{43}$/);
    expect(body.token).toMatchObject({ name: "Results sync", scopes: ["read"], state: "active", prefix: secret.slice(0, 10), lastUsedAt: null });
    expect(new Date(body.token.expiresAt).getTime() - Date.now()).toBeGreaterThan(29 * 86_400_000);

    const row = await prisma.apiToken.findUniqueOrThrow({ where: { id } });
    expect(row.tokenHash).toBe(sha256(secret));
    expect(JSON.stringify(row)).not.toContain(secret);

    const list = await api().get("/api/auth/tokens").set("Cookie", u.cookie);
    S.TokenList.parse(list.body);
    expect(list.body.tokens).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(secret);
  });

  it("always pairs write with read, and defaults to 90 days", async () => {
    const u = await makeUser();
    const { body } = await createToken(u, { name: "Bot", scopes: ["write"] });
    expect(body.token.scopes).toEqual(["read", "write"]);
    expect(Math.round((new Date(body.token.expiresAt).getTime() - Date.now()) / 86_400_000)).toBe(90);
    const never = await createToken(u, { name: "Forever", scopes: ["read"], expiresInDays: null });
    expect(never.body.token.expiresAt).toBeNull();
  });

  it("validates the request", async () => {
    const u = await makeUser();
    for (const body of [{ name: "", scopes: ["read"] }, { name: "x", scopes: [] }, { name: "x", scopes: ["admin"] }, { name: "x", scopes: ["read"], expiresInDays: 12 }, { name: "x".repeat(61), scopes: ["read"] }]) {
      const r = await api().post("/api/auth/tokens").set("Cookie", u.cookie).send(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    expect((await api().post("/api/auth/tokens").send({ name: "x", scopes: ["read"] })).status).toBe(401);
  });

  it("caps active tokens per user", async () => {
    const u = await makeUser();
    for (let i = 0; i < 25; i++) await createToken(u, { name: `t${i}`, scopes: ["read"] });
    const r = await api().post("/api/auth/tokens").set("Cookie", u.cookie).send({ name: "one too many", scopes: ["read"] });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("too_many_tokens");
  });
});

describe("using tokens", () => {
  it("act as their owner, including the owner's role checks", async () => {
    const ctx = await makeEvent();
    const { secret } = await createToken(ctx.organizer);
    const me = await api().get("/api/auth/me").set(bearer(secret));
    expect(me.body.user.id).toBe(ctx.organizer.id);
    expect((await api().get(`${ctx.base}/progress`).set(bearer(secret))).status).toBe(200);

    const participant = await makeUser();
    const { secret: theirs } = await createToken(participant);
    const denied = await api().get(`${ctx.base}/progress`).set(bearer(theirs));
    expect(denied.status).toBe(403);
  });

  it("keep judges isolated from each other's scores", async () => {
    const ctx = await makeEvent();
    const a = await makeJudge(ctx.event.id);
    const b = await makeJudge(ctx.event.id);
    const { secret } = await createToken(a);
    expect((await api().get(`${ctx.base}/judges/me/scores`).set(bearer(secret))).status).toBe(200);
    const peer = await api().get(`${ctx.base}/judges/${b.id}/scores`).set(bearer(secret));
    expect(peer.status).toBe(403);
  });

  it("need the write scope to change anything", async () => {
    const ctx = await makeEvent();
    const { secret: read } = await createToken(ctx.organizer, { name: "reader", scopes: ["read"] });
    const r = await api().patch(ctx.base).set(bearer(read)).send({ tagline: "from a script" });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("insufficient_scope");
    expect(r.headers["www-authenticate"]).toContain("insufficient_scope");

    const { secret: write } = await createToken(ctx.organizer, { name: "Nightly sync", scopes: ["read", "write"] });
    const ok = await api().patch(ctx.base).set(bearer(write)).send({ tagline: "from a script" });
    expect(ok.status).toBe(200);

    // The audit log says a script did it, and which token.
    const entry = await prisma.auditLog.findFirst({ where: { eventId: ctx.event.id, action: "event.update" }, orderBy: { id: "desc" } });
    expect(entry?.actorLabel).toBe(`${ctx.organizer.email} (API token "Nightly sync")`);
    expect(entry?.actorUserId).toBe(ctx.organizer.id);
  });

  it("record when and from where they were last used", async () => {
    const u = await makeUser();
    const { id, secret } = await createToken(u);
    await api().get("/api/auth/me").set(bearer(secret));
    const row = await prisma.apiToken.findUniqueOrThrow({ where: { id } });
    expect(row.lastUsedAt).not.toBeNull();
    expect(row.lastUsedIp).toBeTruthy();
  });

  it("carry rate-limit headers", async () => {
    const u = await makeUser();
    const { secret } = await createToken(u);
    const first = await api().get("/api/auth/me").set(bearer(secret));
    const second = await api().get("/api/auth/me").set(bearer(secret));
    expect(first.headers["ratelimit-limit"]).toBe("600");
    expect(Number(second.headers["ratelimit-remaining"])).toBe(Number(first.headers["ratelimit-remaining"]) - 1);
  });

  it("are refused loudly when unknown, revoked or expired", async () => {
    const bogus = await api().get("/api/auth/me").set(bearer(`dfp_${"x".repeat(43)}`));
    expect(bogus.status).toBe(401);
    expect(bogus.body.error.code).toBe("invalid_token");

    const u = await makeUser();
    const expired = await createToken(u, { name: "old", scopes: ["read"] });
    await prisma.apiToken.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const e = await api().get("/api/auth/me").set(bearer(expired.secret));
    expect(e.status).toBe(401);
    expect(e.body.error.message).toContain("expired");
  });

  it("still accept session tokens as bearer tokens (the acceptance checker's headers)", async () => {
    const u = await makeUser();
    const session = u.cookie.replace("sid=", "");
    const me = await api().get("/api/auth/me").set(bearer(session));
    expect(me.body.user.id).toBe(u.id);
  });
});

describe("revoking tokens", () => {
  it("takes effect on the next request and is audited", async () => {
    const u = await makeUser();
    const { id, secret } = await createToken(u);
    expect((await api().get("/api/auth/me").set(bearer(secret))).status).toBe(200);

    expect((await api().delete(`/api/auth/tokens/${id}`).set("Cookie", u.cookie)).status).toBe(204);
    expect((await api().delete(`/api/auth/tokens/${id}`).set("Cookie", u.cookie)).status).toBe(204); // idempotent
    const r = await api().get("/api/auth/me").set(bearer(secret));
    expect(r.status).toBe(401);
    expect(r.body.error.message).toContain("revoked");

    const actions = (await prisma.auditLog.findMany({ where: { entityId: id }, orderBy: { id: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["api_token.created", "api_token.revoked"]);
    const list = await api().get("/api/auth/tokens").set("Cookie", u.cookie);
    expect(list.body.tokens[0].state).toBe("revoked");
  });

  it("only works on your own tokens", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const { id, secret } = await createToken(owner);
    expect((await api().delete(`/api/auth/tokens/${id}`).set("Cookie", other.cookie)).status).toBe(404);
    expect((await api().get("/api/auth/me").set(bearer(secret))).status).toBe(200);
  });
});

describe("browser-only actions", () => {
  it("refuse API tokens on every operation documented as browser-only", async () => {
    const ctx = await makeEvent();
    const { project } = await makeTeamWithProject(ctx.event.id, ctx.trackA.id);
    const u = await makeUser();
    const { secret } = await createToken(u, { name: "bot", scopes: ["read", "write"] });
    const browserOnly = OPERATIONS.filter((o) => o.browserOnly);
    expect(browserOnly.map((o) => `${o.method} ${o.path}`)).toEqual(
      expect.arrayContaining(["post /api/auth/tokens", "put /api/events/:slug/ballot", "post /api/events/:slug/projects/:projectId/comments"]),
    );
    for (const o of browserOnly) {
      const path = o.path.replace(":slug", ctx.event.slug).replace(":projectId", project.id).replace(/:\w+/g, randomUUID());
      const r = await api()[o.method](path).set(bearer(secret)).send({});
      expect(r.status, `${o.method} ${o.path}`).toBe(403);
      expect(r.body.error.code, `${o.method} ${o.path}`).toBe("session_required");
    }
  });
});

describe("OpenAPI document", () => {
  it("is served, public and complete", async () => {
    const r = await api().get("/api/openapi.json");
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toContain("application/json");
    expect(r.body.openapi).toBe("3.1.0");
    const count = Object.values(r.body.paths as Record<string, object>).reduce((n, p) => n + Object.keys(p).length, 0);
    expect(count).toBe(OPERATIONS.length);
  });

  it("describes the responses the API really sends", async () => {
    const ctx = await makeEvent();
    const { project } = await makeTeamWithProject(ctx.event.id, ctx.trackA.id);
    const u = await makeUser();
    S.Health.parse((await api().get("/api/health")).body);
    S.Me.parse((await api().get("/api/auth/me").set("Cookie", u.cookie)).body);
    S.Me.parse((await api().get("/api/auth/me")).body);
    S.EventList.parse((await api().get("/api/events")).body);
    S.EventDetail.parse((await api().get(ctx.base)).body);
    const gallery = (await api().get(`${ctx.base}/projects`)).body;
    S.Gallery.parse(gallery);
    expect(gallery.total).toBe(1);
    S.ProjectDetail.parse((await api().get(`${ctx.base}/projects/${project.id}`)).body);
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    const up = await api().post("/api/uploads").set("Cookie", u.cookie).set("Content-Type", "image/png").send(png);
    expect(up.status).toBe(201);
    S.Upload.parse(up.body);
  });

  it("documents the error shape the API really sends", async () => {
    const r = await api().get("/api/events/no-such-event");
    expect(r.status).toBe(404);
    S.ErrorResponse.parse(r.body);
  });

  it("leaves the audit chain intact", async () => {
    expect((await verifyAuditChain()).ok).toBe(true);
  });
});
