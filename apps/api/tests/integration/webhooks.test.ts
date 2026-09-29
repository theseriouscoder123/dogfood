// T4 phase 2: webhooks. A real local receiver, the real worker and sender, the real database.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { api, makeEvent, makeJudge, makeTeamWithProject, makeUser, prisma } from "./helpers";
import { appendAudit, verifyAuditChain } from "../../src/audit";
import { runWebhookWorkerOnce, type Sender } from "../../src/webhooks/worker";
import { verifyWebhook } from "../../src/webhooks/signature";
import { Envelope, WEBHOOK_EVENTS } from "../../src/webhooks/catalog";
import { MAX_ATTEMPTS } from "../../src/webhooks/retry";

const HOUR = 3_600_000;

// ── a receiver that records what it gets and answers with whatever status we set ──
type Hit = { headers: IncomingHttpHeaders; body: string };
let server: Server;
let base = "";
let status = 204;
const hits: Hit[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      hits.push({ headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      res.writeHead(status).end(status >= 400 ? "nope" : "");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  // The worker sends everything that's due, so each test starts with no webhooks anywhere.
  await prisma.webhook.deleteMany({});
  hits.length = 0;
  status = 204;
});

afterAll(async () => {
  server.close();
  await prisma.$disconnect();
});

async function addWebhook(ctx: Awaited<ReturnType<typeof makeEvent>>, body: Record<string, unknown> = {}) {
  const r = await api().post(`${ctx.base}/webhooks`).set("Cookie", ctx.organizer.cookie).send({ url: `${base}/in`, ...body });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { id: r.body.webhook.id as string, secret: r.body.secret as string };
}

const deliveries = (webhookId: string) => prisma.webhookDelivery.findMany({ where: { webhookId }, orderBy: { createdAt: "asc" } });

describe("managing webhooks", () => {
  it("returns the signing secret once and never lists it", async () => {
    const ctx = await makeEvent();
    const { id, secret } = await addWebhook(ctx, { description: "Slack relay", eventTypes: ["project.submitted"] });
    expect(secret).toMatch(/^whsec_[A-Za-z0-9+/]+=*$/);
    const list = await api().get(`${ctx.base}/webhooks`).set("Cookie", ctx.organizer.cookie);
    expect(list.body.webhooks).toHaveLength(1);
    expect(list.body.webhooks[0]).toMatchObject({ id, description: "Slack relay", eventTypes: ["project.submitted"], active: true });
    expect(JSON.stringify(list.body)).not.toContain(secret);
    expect(list.body.eventTypes.map((t: { type: string }) => t.type)).toContain("results.published");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "webhook.created", entityId: id } });
    expect(JSON.stringify([audit.before, audit.after])).not.toContain(secret);
  });

  it("refuses URLs aimed at internal services", async () => {
    const ctx = await makeEvent();
    for (const url of ["http://169.254.169.254/latest/meta-data/", "http://10.0.0.8/hook", "http://localhost:4000/api/health", "http://[::1]/x", "http://user:pw@example.org/h", "gopher://example.org"]) {
      const r = await api().post(`${ctx.base}/webhooks`).set("Cookie", ctx.organizer.cookie).send({ url });
      expect(r.status, url).toBe(400);
    }
  });

  it("is for organizers only", async () => {
    const ctx = await makeEvent();
    const judge = await makeJudge(ctx.event.id);
    const stranger = await makeUser();
    for (const cookie of [judge.cookie, stranger.cookie]) {
      expect((await api().get(`${ctx.base}/webhooks`).set("Cookie", cookie)).status).toBe(403);
      expect((await api().post(`${ctx.base}/webhooks`).set("Cookie", cookie).send({ url: `${base}/in` })).status).toBe(403);
    }
    const { id } = await addWebhook(ctx);
    const other = await makeEvent();
    expect((await api().get(`${other.base}/webhooks/${id}`).set("Cookie", other.organizer.cookie)).status).toBe(404);
  });
});

describe("the outbox", () => {
  it("queues a delivery in the same transaction as the change, and only for subscribers", async () => {
    const ctx = await makeEvent();
    const all = await addWebhook(ctx);
    const resultsOnly = await addWebhook(ctx, { eventTypes: ["results.published"] });
    const { member, project } = await makeTeamWithProject(ctx.event.id, ctx.trackA.id, "Glass Signal");
    expect((await api().post(`${ctx.base}/projects/${project.id}/unsubmit`).set("Cookie", member.cookie)).status).toBe(200);
    expect((await api().post(`${ctx.base}/projects/${project.id}/submit`).set("Cookie", member.cookie)).status).toBe(200);

    const got = await deliveries(all.id);
    expect(got.map((d) => d.eventType)).toEqual(["project.unsubmitted", "project.submitted"]);
    expect(await deliveries(resultsOnly.id)).toHaveLength(0);

    // The payload is the documented envelope, with the documented data for its type.
    const payload = Envelope.extend({ data: WEBHOOK_EVENTS["project.submitted"].data }).parse(got[1]!.payload);
    expect(payload.data.project).toMatchObject({ id: project.id, title: "Glass Signal", status: "submitted" });
    expect(payload.data.project.url).toContain(`/api/events/${ctx.event.slug}/projects/${project.id}`);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "project.submit", entityId: project.id }, orderBy: { id: "desc" } });
    expect(payload.id).toBe(`evt_${audit.id}`);
  });

  it("queues nothing when the change rolls back", async () => {
    const ctx = await makeEvent();
    const { id } = await addWebhook(ctx);
    await expect(
      prisma.$transaction(async (tx) => {
        await appendAudit(tx, { eventId: ctx.event.id, actorLabel: "test", action: "event.update", entityType: "Event", entityId: ctx.event.id, after: { name: "x" } });
        throw new Error("rolled back");
      }),
    ).rejects.toThrow("rolled back");
    expect(await deliveries(id)).toHaveLength(0);
  });

  it("queues nothing for refused requests", async () => {
    const ctx = await makeEvent({ open: false });
    const { id } = await addWebhook(ctx);
    const { member, project } = await makeTeamWithProject(ctx.event.id, ctx.trackA.id);
    expect((await api().post(`${ctx.base}/projects/${project.id}/unsubmit`).set("Cookie", member.cookie)).status).toBe(403);
    expect(await deliveries(id)).toHaveLength(0);
  });

  it("keeps payloads thin: no review scores or comments", async () => {
    const ctx = await makeEvent();
    const { id } = await addWebhook(ctx);
    await prisma.$transaction((tx) =>
      appendAudit(tx, { eventId: ctx.event.id, actorLabel: "test", action: "review.submit", entityType: "Review", entityId: crypto.randomUUID(), after: { scores: { quality: 5 }, comment: "secret notes" } }),
    );
    const [d] = await deliveries(id);
    expect(d!.eventType).toBe("review.submitted");
    expect(JSON.stringify(d!.payload)).not.toMatch(/scores|secret notes/);
  });

  it("never announces ballots, even to an all-events subscriber", async () => {
    const ctx = await makeEvent({ open: false });
    const { id } = await addWebhook(ctx);
    const { project } = await makeTeamWithProject(ctx.event.id, ctx.trackA.id);
    await api().put(`${ctx.base}/voting/settings`).set("Cookie", ctx.organizer.cookie)
      .send({ opensAt: ctx.event.submissionsCloseAt.toISOString(), closesAt: new Date(Date.now() + 24 * HOUR).toISOString(), mode: "email", votesPerVoter: 1, voterDomains: [] });
    const voter = await makeUser();
    await prisma.user.update({ where: { id: voter.id }, data: { emailVerifiedAt: new Date() } });
    expect((await api().put(`${ctx.base}/ballot`).set("Cookie", voter.cookie).send({ projectIds: [project.id] })).status).toBe(200);
    expect(await deliveries(id)).toHaveLength(0);
  });
});

describe("delivery", () => {
  it("POSTs a payload the receiver can verify with its secret", async () => {
    const ctx = await makeEvent();
    const { id, secret } = await addWebhook(ctx);
    await api().patch(ctx.base).set("Cookie", ctx.organizer.cookie).send({ tagline: "now with webhooks" });
    expect(await runWebhookWorkerOnce()).toBe(1);

    expect(hits).toHaveLength(1);
    const hit = hits[0]!;
    expect(hit.headers["content-type"]).toBe("application/json");
    expect(verifyWebhook(secret, hit.headers, hit.body)).toEqual({ ok: true });
    const body = JSON.parse(hit.body);
    expect(body).toMatchObject({ type: "event.updated", event: { slug: ctx.event.slug }, data: { changed: ["tagline"] } });
    expect(hit.headers["webhook-id"]).toBe(body.id);

    const [d] = await deliveries(id);
    expect(d).toMatchObject({ status: "succeeded", attempts: 1, lastStatusCode: 204 });
    const detail = await api().get(`${ctx.base}/webhooks/${id}/deliveries/${d!.id}`).set("Cookie", ctx.organizer.cookie);
    expect(detail.body.attempts).toHaveLength(1);
    expect(detail.body.attempts[0].statusCode).toBe(204);
    expect(detail.body.delivery.payload.id).toBe(body.id);
  });

  it("retries with backoff, then gives up", async () => {
    const ctx = await makeEvent();
    const { id } = await addWebhook(ctx);
    status = 500;
    await api().post(`${ctx.base}/webhooks/${id}/ping`).set("Cookie", ctx.organizer.cookie);
    const t0 = Date.now();
    await runWebhookWorkerOnce({ random: () => 0.5 });
    let [d] = await deliveries(id);
    expect(d).toMatchObject({ status: "pending", attempts: 1, lastStatusCode: 500 });
    expect(d!.nextAttemptAt.getTime() - t0).toBeGreaterThanOrEqual(59_000);
    expect(await runWebhookWorkerOnce()).toBe(0); // not due yet

    // Fast-forward through the schedule with a fake clock and sender.
    const failing: Sender = async () => ({ statusCode: 503, body: null, error: null, durationMs: 1 });
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      const due = (await deliveries(id))[0]!.nextAttemptAt.getTime() + 1000;
      expect(await runWebhookWorkerOnce({ send: failing, now: () => new Date(due), random: () => 0.5 })).toBe(1);
    }
    [d] = await deliveries(id);
    expect(d).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
    expect(await prisma.webhookAttempt.count({ where: { deliveryId: d!.id } })).toBe(MAX_ATTEMPTS);
    const w = await prisma.webhook.findUniqueOrThrow({ where: { id } });
    expect(w.active).toBe(false); // failing for about 45 hours: the endpoint is dead
    expect(w.disabledReason).toMatch(/failed attempts in a row/);
    expect(await prisma.auditLog.count({ where: { action: "webhook.disabled", entityId: id } })).toBe(1);
  });

  it("switches an endpoint off when it answers 410 Gone, and back on by hand", async () => {
    const ctx = await makeEvent();
    const { id } = await addWebhook(ctx);
    status = 410;
    await api().post(`${ctx.base}/webhooks/${id}/ping`).set("Cookie", ctx.organizer.cookie);
    await runWebhookWorkerOnce();
    expect((await prisma.webhook.findUniqueOrThrow({ where: { id } })).active).toBe(false);
    expect((await deliveries(id))[0]!.status).toBe("failed");

    // Nothing is queued for a switched-off endpoint, so switching it back on doesn't unleash a backlog.
    await api().patch(ctx.base).set("Cookie", ctx.organizer.cookie).send({ tagline: "while off" });
    expect(await deliveries(id)).toHaveLength(1);
    expect((await api().post(`${ctx.base}/webhooks/${id}/ping`).set("Cookie", ctx.organizer.cookie)).body.error.code).toBe("webhook_disabled");
    status = 204;
    const on = await api().patch(`${ctx.base}/webhooks/${id}`).set("Cookie", ctx.organizer.cookie).send({ active: true });
    expect(on.body.webhook).toMatchObject({ active: true, disabledReason: null, consecutiveFailures: 0 });
    await api().patch(ctx.base).set("Cookie", ctx.organizer.cookie).send({ tagline: "back on" });
    expect(await runWebhookWorkerOnce()).toBe(1);
    expect(JSON.parse(hits.at(-1)!.body).type).toBe("event.updated");
  });

  it("does not follow redirects", async () => {
    const ctx = await makeEvent();
    const { id } = await addWebhook(ctx);
    status = 302;
    await api().post(`${ctx.base}/webhooks/${id}/ping`).set("Cookie", ctx.organizer.cookie);
    await runWebhookWorkerOnce();
    const [d] = await deliveries(id);
    expect(d).toMatchObject({ status: "pending", lastStatusCode: 302, lastError: "Redirects are not followed." });
  });

  it("sends each delivery once, even with two workers running", async () => {
    const ctx = await makeEvent();
    const { id } = await addWebhook(ctx);
    for (let i = 0; i < 12; i++) await api().post(`${ctx.base}/webhooks/${id}/ping`).set("Cookie", ctx.organizer.cookie);
    let calls = 0;
    const slow: Sender = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 50));
      return { statusCode: 200, body: null, error: null, durationMs: 50 };
    };
    const [a, b] = await Promise.all([runWebhookWorkerOnce({ send: slow, limit: 8 }), runWebhookWorkerOnce({ send: slow, limit: 8 })]);
    await runWebhookWorkerOnce({ send: slow });
    expect(a + b).toBeLessThanOrEqual(12);
    expect(calls).toBe(12);
    expect((await deliveries(id)).every((d) => d.status === "succeeded" && d.attempts === 1)).toBe(true);
  });

  it("signs with both secrets for a day after a rotation", async () => {
    const ctx = await makeEvent();
    const { id, secret: oldSecret } = await addWebhook(ctx);
    const r = await api().post(`${ctx.base}/webhooks/${id}/rotate-secret`).set("Cookie", ctx.organizer.cookie);
    const newSecret = r.body.secret as string;
    expect(newSecret).not.toBe(oldSecret);
    await api().post(`${ctx.base}/webhooks/${id}/ping`).set("Cookie", ctx.organizer.cookie);
    await runWebhookWorkerOnce();
    const hit = hits[0]!;
    expect(verifyWebhook(oldSecret, hit.headers, hit.body).ok).toBe(true);
    expect(verifyWebhook(newSecret, hit.headers, hit.body).ok).toBe(true);

    await prisma.webhook.update({ where: { id }, data: { previousSecretExpiresAt: new Date(Date.now() - 1000) } });
    await api().post(`${ctx.base}/webhooks/${id}/ping`).set("Cookie", ctx.organizer.cookie);
    await runWebhookWorkerOnce();
    expect(verifyWebhook(oldSecret, hits[1]!.headers, hits[1]!.body).ok).toBe(false);
    expect(verifyWebhook(newSecret, hits[1]!.headers, hits[1]!.body).ok).toBe(true);
  });

  it("redelivers a finished delivery with the same message id", async () => {
    const ctx = await makeEvent();
    const { id } = await addWebhook(ctx);
    await api().post(`${ctx.base}/webhooks/${id}/ping`).set("Cookie", ctx.organizer.cookie);
    await runWebhookWorkerOnce();
    const [first] = await deliveries(id);
    const again = await api().post(`${ctx.base}/webhooks/${id}/deliveries/${first!.id}/redeliver`).set("Cookie", ctx.organizer.cookie);
    expect(again.status).toBe(201);
    expect(again.body.delivery).toMatchObject({ messageId: first!.messageId, redeliveryOfId: first!.id, status: "pending" });
    await runWebhookWorkerOnce();
    expect(hits.map((h) => h.headers["webhook-id"])).toEqual([first!.messageId, first!.messageId]);
    expect(await prisma.auditLog.count({ where: { action: "webhook.redelivered", entityId: again.body.delivery.id } })).toBe(1);
  });

  it("leaves the audit chain intact", async () => {
    expect((await verifyAuditChain()).ok).toBe(true);
  });
});

describe("chat formats", () => {
  it("send Slack and Discord endpoints a readable message instead of raw JSON", async () => {
    const ctx = await makeEvent();
    const slack = await addWebhook(ctx, { format: "slack" });
    await api().post(`${ctx.base}/webhooks/${slack.id}/ping`).set("Cookie", ctx.organizer.cookie);
    const { project, member } = await makeTeamWithProject(ctx.event.id, ctx.trackA.id, "Nightjar");
    await api().post(`${ctx.base}/projects/${project.id}/unsubmit`).set("Cookie", member.cookie);
    await api().post(`${ctx.base}/projects/${project.id}/submit`).set("Cookie", member.cookie);
    await runWebhookWorkerOnce();
    const texts = hits.map((h) => JSON.parse(h.body).text as string);
    expect(texts).toContain("Verdict is connected. Updates from Test Event will appear here.");
    expect(texts.find((t) => t.startsWith("“Nightjar” was submitted to Test Event."))).toContain(`/projects/${project.id}`);

    const discord = await addWebhook(ctx, { format: "discord", eventTypes: ["results.published"] });
    hits.length = 0;
    await api().post(`${ctx.base}/webhooks/${discord.id}/ping`).set("Cookie", ctx.organizer.cookie);
    await runWebhookWorkerOnce();
    expect(JSON.parse(hits[0]!.body)).toMatchObject({ content: expect.stringContaining("Verdict is connected"), allowed_mentions: { parse: [] } });
    expect((await api().post(`${ctx.base}/webhooks`).set("Cookie", ctx.organizer.cookie).send({ url: `${base}/x`, format: "teams" })).status).toBe(400);
  });
});
