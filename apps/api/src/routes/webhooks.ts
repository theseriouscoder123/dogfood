// Organizer webhooks: endpoints, their secrets, test pings, and the delivery log with redelivery.
// Mounted at /api/events/:slug. Organizer-only; API tokens with the right scope can manage them too.
import { Router, type Request } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { prisma } from "../db";
import { config } from "../config";
import { accessFor, decideOrganize, enforce } from "../policy";
import { appendAudit, fromRequest } from "../audit";
import { eventBySlug } from "../lib/events";
import { HttpError, notFound } from "../lib/http";
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_TYPES } from "../webhooks/catalog";
import { checkWebhookUrl } from "../webhooks/address";
import { newWebhookSecret } from "../webhooks/signature";
import { enqueuePing, redeliver } from "../webhooks/outbox";
import { MAX_ATTEMPTS, RETRY_DELAYS_MS } from "../webhooks/retry";
import { FORMATS } from "../webhooks/chat";

export const webhooksRouter = Router({ mergeParams: true });

const MAX_WEBHOOKS_PER_EVENT = 10;
const ROTATION_OVERLAP_MS = 24 * 3_600_000;

const WebhookUrl = z
  .string()
  .trim()
  .max(2000)
  .superRefine((url, ctx) => {
    const problem = checkWebhookUrl(url, config.webhookAllowPrivateHosts);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  })
  .describe("Where to POST deliveries. http(s) only; private and internal addresses are refused.");

export const CreateWebhookBody = z.object({
  url: WebhookUrl,
  description: z.string().trim().max(200).default(""),
  eventTypes: z
    .array(z.enum(WEBHOOK_EVENT_TYPES as [string, ...string[]]))
    .max(WEBHOOK_EVENT_TYPES.length)
    .transform((t) => [...new Set(t)].sort())
    .default([])
    .describe("The event types to send. Empty means every type, including ones added later."),
  format: z.enum(FORMATS).default("standard").describe("standard: signed JSON for your own code. slack or discord: a readable message for an incoming-webhook URL."),
});

export const UpdateWebhookBody = z.object({
  url: WebhookUrl.optional(),
  description: z.string().trim().max(200).optional(),
  eventTypes: CreateWebhookBody.shape.eventTypes.optional(),
  format: z.enum(FORMATS).optional(),
  active: z.boolean().optional().describe("Switching an endpoint back on also clears its failure streak."),
});

export const DeliveriesQuery = z.object({ status: z.enum(["pending", "succeeded", "failed"]).optional() });

async function staffEvent(req: Request) {
  const event = await eventBySlug((req.params as { slug?: string }).slug);
  enforce(decideOrganize(await accessFor(req.actor, event.id)));
  return event;
}

async function ownWebhook(req: Request, eventId: string) {
  const id = (req.params as { webhookId: string }).webhookId;
  const w = z.uuid().safeParse(id).success ? await prisma.webhook.findFirst({ where: { id, eventId } }) : null;
  if (!w) throw notFound("Webhook");
  return w;
}

const view = (w: { id: string; url: string; description: string; eventTypes: string[]; format: string; active: boolean; disabledReason: string | null; consecutiveFailures: number; failingSince: Date | null; previousSecretExpiresAt: Date | null; createdAt: Date }) => ({
  id: w.id,
  url: w.url,
  description: w.description,
  eventTypes: w.eventTypes,
  format: w.format,
  active: w.active,
  disabledReason: w.disabledReason,
  consecutiveFailures: w.consecutiveFailures,
  failingSince: w.failingSince,
  rotatingUntil: w.previousSecretExpiresAt && w.previousSecretExpiresAt > new Date() ? w.previousSecretExpiresAt : null,
  createdAt: w.createdAt,
});

const deliveryView = (d: { id: string; messageId: string; eventType: string; status: string; attempts: number; nextAttemptAt: Date; lastAttemptAt: Date | null; lastStatusCode: number | null; lastError: string | null; deliveredAt: Date | null; redeliveryOfId: string | null; createdAt: Date }) => ({
  id: d.id,
  messageId: d.messageId,
  eventType: d.eventType,
  status: d.status,
  attempts: d.attempts,
  nextAttemptAt: d.status === "pending" ? d.nextAttemptAt : null,
  lastAttemptAt: d.lastAttemptAt,
  lastStatusCode: d.lastStatusCode,
  lastError: d.lastError,
  deliveredAt: d.deliveredAt,
  redeliveryOfId: d.redeliveryOfId,
  createdAt: d.createdAt,
});

/** Endpoints with 24-hour delivery counts, plus the catalogue of event types to subscribe to. */
webhooksRouter.get("/webhooks", async (req, res) => {
  const event = await staffEvent(req);
  const hooks = await prisma.webhook.findMany({ where: { eventId: event.id }, orderBy: { createdAt: "asc" } });
  const since = new Date(Date.now() - 86_400_000);
  const counts = await prisma.webhookDelivery.groupBy({ by: ["webhookId", "status"], where: { webhook: { eventId: event.id }, createdAt: { gt: since } }, _count: { _all: true } });
  const last = await Promise.all(hooks.map((h) => prisma.webhookDelivery.findFirst({ where: { webhookId: h.id, lastAttemptAt: { not: null } }, orderBy: { lastAttemptAt: "desc" }, select: { lastAttemptAt: true, lastStatusCode: true, status: true } })));
  res.json({
    webhooks: hooks.map((h, i) => {
      const n = (status: string) => counts.find((c) => c.webhookId === h.id && c.status === status)?._count._all ?? 0;
      return { ...view(h), last24h: { succeeded: n("succeeded"), failed: n("failed"), pending: n("pending") }, lastAttempt: last[i] ?? null };
    }),
    eventTypes: WEBHOOK_EVENT_TYPES.map((type) => ({ type, description: WEBHOOK_EVENTS[type].description })),
    limits: { maxWebhooks: MAX_WEBHOOKS_PER_EVENT, maxAttempts: MAX_ATTEMPTS, retryDelaysMs: RETRY_DELAYS_MS },
  });
});

webhooksRouter.post("/webhooks", async (req, res) => {
  const event = await staffEvent(req);
  const body = CreateWebhookBody.parse(req.body);
  const secret = newWebhookSecret();
  const created = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${event.id}::uuid FOR UPDATE`; // count and insert as one step
    if ((await tx.webhook.count({ where: { eventId: event.id } })) >= MAX_WEBHOOKS_PER_EVENT)
      throw new HttpError(409, "too_many_webhooks", `An event can have up to ${MAX_WEBHOOKS_PER_EVENT} webhooks.`);
    const w = await tx.webhook.create({ data: { eventId: event.id, url: body.url, description: body.description, eventTypes: body.eventTypes, format: body.format, secret, createdById: req.actor!.id } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "webhook.created", entityType: "Webhook", entityId: w.id, after: { url: w.url, eventTypes: w.eventTypes } });
    return w;
  });
  res.status(201).json({ webhook: view(created), secret });
});

webhooksRouter.get("/webhooks/:webhookId", async (req, res) => {
  const event = await staffEvent(req);
  const w = await ownWebhook(req, event.id);
  const { status } = DeliveriesQuery.parse(req.query);
  const deliveries = await prisma.webhookDelivery.findMany({ where: { webhookId: w.id, ...(status ? { status } : {}) }, orderBy: { createdAt: "desc" }, take: 100 });
  res.json({ webhook: view(w), deliveries: deliveries.map(deliveryView) });
});

webhooksRouter.patch("/webhooks/:webhookId", async (req, res) => {
  const event = await staffEvent(req);
  const w = await ownWebhook(req, event.id);
  const body = UpdateWebhookBody.parse(req.body);
  const changed = (Object.keys(body) as Array<keyof typeof body>).filter((k) => body[k] !== undefined && JSON.stringify(body[k]) !== JSON.stringify(w[k]));
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.webhook.update({
      where: { id: w.id },
      data: { ...body, ...(body.active === true && !w.active ? { disabledReason: null, consecutiveFailures: 0, failingSince: null } : {}) },
    });
    if (changed.length)
      await appendAudit(tx, {
        ...fromRequest(req), eventId: event.id, action: "webhook.updated", entityType: "Webhook", entityId: w.id,
        before: Object.fromEntries(changed.map((k) => [k, w[k]])), after: Object.fromEntries(changed.map((k) => [k, u[k]])),
      });
    return u;
  });
  res.json({ webhook: view(updated) });
});

webhooksRouter.delete("/webhooks/:webhookId", async (req, res) => {
  const event = await staffEvent(req);
  const w = await ownWebhook(req, event.id);
  await prisma.$transaction(async (tx) => {
    await tx.webhook.delete({ where: { id: w.id } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "webhook.deleted", entityType: "Webhook", entityId: w.id, before: { url: w.url, eventTypes: w.eventTypes } });
  });
  res.status(204).end();
});

/** A new secret, returned once. The old one keeps signing alongside it for 24 hours, so receivers can switch without dropping anything. */
webhooksRouter.post("/webhooks/:webhookId/rotate-secret", async (req, res) => {
  const event = await staffEvent(req);
  const w = await ownWebhook(req, event.id);
  const secret = newWebhookSecret();
  const until = new Date(Date.now() + ROTATION_OVERLAP_MS);
  await prisma.$transaction(async (tx) => {
    await tx.webhook.update({ where: { id: w.id }, data: { secret, previousSecret: w.secret, previousSecretExpiresAt: until } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "webhook.secret_rotated", entityType: "Webhook", entityId: w.id, after: { previousValidUntil: until } });
  });
  res.json({ secret, previousSecretValidUntil: until });
});

webhooksRouter.post("/webhooks/:webhookId/ping", async (req, res) => {
  const event = await staffEvent(req);
  const w = await ownWebhook(req, event.id);
  if (!w.active) throw new HttpError(409, "webhook_disabled", "Switch the webhook on first.");
  const d = await prisma.$transaction(async (tx) => {
    const d = await enqueuePing(tx, w, randomUUID());
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "webhook.test_sent", entityType: "Webhook", entityId: w.id });
    return d;
  });
  res.status(201).json({ delivery: deliveryView(d) });
});

webhooksRouter.get("/webhooks/:webhookId/deliveries/:deliveryId", async (req, res) => {
  const event = await staffEvent(req);
  const w = await ownWebhook(req, event.id);
  const deliveryId = (req.params as { deliveryId: string }).deliveryId;
  const d = z.uuid().safeParse(deliveryId).success
    ? await prisma.webhookDelivery.findFirst({ where: { id: deliveryId, webhookId: w.id }, include: { attemptLog: { orderBy: { attemptedAt: "asc" } } } })
    : null;
  if (!d) throw notFound("Delivery");
  res.json({
    delivery: { ...deliveryView(d), payload: d.payload },
    attempts: d.attemptLog.map((a) => ({ attemptedAt: a.attemptedAt, durationMs: a.durationMs, statusCode: a.statusCode, error: a.error, responseBody: a.responseBody })),
  });
});

webhooksRouter.post("/webhooks/:webhookId/deliveries/:deliveryId/redeliver", async (req, res) => {
  const event = await staffEvent(req);
  const w = await ownWebhook(req, event.id);
  if (!w.active) throw new HttpError(409, "webhook_disabled", "Switch the webhook on first.");
  const deliveryId = (req.params as { deliveryId: string }).deliveryId;
  const d = z.uuid().safeParse(deliveryId).success ? await prisma.webhookDelivery.findFirst({ where: { id: deliveryId, webhookId: w.id } }) : null;
  if (!d) throw notFound("Delivery");
  if (d.status === "pending") throw new HttpError(409, "still_pending", "This delivery is still being tried.");
  const copy = await prisma.$transaction(async (tx) => {
    const c = await redeliver(tx, d);
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "webhook.redelivered", entityType: "WebhookDelivery", entityId: c.id, after: { of: d.id, messageId: d.messageId, eventType: d.eventType } });
    return c;
  });
  res.status(201).json({ delivery: deliveryView(copy) });
});
