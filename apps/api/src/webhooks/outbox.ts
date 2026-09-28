// Writing deliveries. Everything here runs inside the caller's transaction, so a webhook is queued
// if and only if the change it announces commits: no announcements of rolled-back changes, and
// no committed change that silently skipped its webhook.
import type { Prisma } from "@prisma/client";
import { PING_TYPE, buildData, subscribes, typeForAction, type AuditFacts } from "./catalog";

type Tx = Prisma.TransactionClient;

/** Called by appendAudit() for every audited change that belongs to an event. */
export async function enqueueForAudit(tx: Tx, eventId: string, facts: AuditFacts, auditId: bigint, at: Date): Promise<number> {
  const type = typeForAction(facts.action);
  if (!type) return 0;
  const hooks = (await tx.webhook.findMany({ where: { eventId, active: true }, select: { id: true, eventTypes: true } })).filter((h) => subscribes(h.eventTypes, type));
  if (hooks.length === 0) return 0;
  const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { slug: true, name: true } });
  const payload = {
    id: `evt_${auditId}`,
    type,
    timestamp: at.toISOString(),
    event,
    data: await buildData(type, { tx, a: facts, slug: event.slug }),
  };
  await tx.webhookDelivery.createMany({
    data: hooks.map((h) => ({ webhookId: h.id, messageId: payload.id, eventType: type, payload: payload as Prisma.InputJsonValue, nextAttemptAt: at })),
  });
  return hooks.length;
}

export async function enqueuePing(tx: Tx, webhook: { id: string; eventId: string }, pingId: string) {
  const event = await tx.event.findUniqueOrThrow({ where: { id: webhook.eventId }, select: { slug: true, name: true } });
  const now = new Date();
  const payload = {
    id: `evt_ping_${pingId}`,
    type: PING_TYPE,
    timestamp: now.toISOString(),
    event,
    data: { webhookId: webhook.id, message: "Test delivery from Dogfood. If you can read this, your endpoint works." },
  };
  return tx.webhookDelivery.create({ data: { webhookId: webhook.id, messageId: payload.id, eventType: PING_TYPE, payload, nextAttemptAt: now } });
}

/** A fresh delivery of the same payload (same message id, so receivers that already have it can skip it). */
export async function redeliver(tx: Tx, original: { id: string; webhookId: string; messageId: string; eventType: string; payload: Prisma.JsonValue }) {
  return tx.webhookDelivery.create({
    data: { webhookId: original.webhookId, messageId: original.messageId, eventType: original.eventType, payload: original.payload as Prisma.InputJsonValue, redeliveryOfId: original.id, nextAttemptAt: new Date() },
  });
}
