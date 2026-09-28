// Sends queued deliveries. At-least-once: a delivery is claimed (FOR UPDATE SKIP LOCKED, so any
// number of API processes can run the worker side by side), sent, then recorded. If the process
// dies mid-send, the claim expires and the delivery is sent again with the same message id.
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { config } from "../config";
import { appendAudit } from "../audit";
import { canonicalJson } from "../lib/crypto";
import { signedHeaders } from "./signature";
import { bodyFor } from "./chat";
import { afterAttempt, isSuccess, nextAttemptAt } from "./retry";
import { resolveForDelivery } from "./address";

export type SendResult = { statusCode: number | null; body: string | null; error: string | null; durationMs: number };
export type Sender = (url: string, headers: Record<string, string>, body: string) => Promise<SendResult>;

const TIMEOUT_MS = 10_000;
const CLAIM_MS = 2 * 60_000;
const BATCH = 20;
/** Deliveries in flight at once. Each finishes with a short transaction, so this also bounds database connections. */
const CONCURRENCY = 4;
const KEEP_DAYS = 30;

/** The real sender: SSRF check, then one POST. Redirects are not followed, so they can't be used to reach an internal address. */
export const httpSend: Sender = async (url, headers, body) => {
  const started = Date.now();
  const blocked = await resolveForDelivery(url, config.webhookAllowPrivateHosts);
  if (blocked) return { statusCode: null, body: null, error: `Blocked: ${blocked}`, durationMs: 0 };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Dogfood-Webhooks/1.0", ...headers },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = (await res.text().catch(() => "")).slice(0, 1000);
    return { statusCode: res.status, body: text || null, error: res.status >= 300 && res.status < 400 ? "Redirects are not followed." : null, durationMs: Date.now() - started };
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } };
    const reason = e.name === "TimeoutError" ? `No response within ${TIMEOUT_MS / 1000}s.` : (e.cause?.code ?? e.message);
    return { statusCode: null, body: null, error: reason, durationMs: Date.now() - started };
  }
};

/** Claim deliveries that are due, on endpoints that are switched on. */
async function claim(now: Date, limit: number): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "WebhookDelivery" SET "lockedUntil" = ${new Date(now.getTime() + CLAIM_MS)}
    WHERE id IN (
      SELECT d.id FROM "WebhookDelivery" d JOIN "Webhook" w ON w.id = d."webhookId"
      WHERE d.status = 'pending' AND w.active AND d."nextAttemptAt" <= ${now}
        AND (d."lockedUntil" IS NULL OR d."lockedUntil" < ${now})
      ORDER BY d."nextAttemptAt"
      LIMIT ${limit}
      FOR UPDATE OF d SKIP LOCKED
    )
    RETURNING id`;
  return rows.map((r) => r.id);
}

async function attempt(deliveryId: string, send: Sender, now: () => Date, random: () => number) {
  const d = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: deliveryId }, include: { webhook: true } });
  const w = d.webhook;
  const signedAt = now();
  const secrets = [w.secret, ...(w.previousSecret && w.previousSecretExpiresAt && w.previousSecretExpiresAt > signedAt ? [w.previousSecret] : [])];
  // Chat formats (Slack, Discord) get a readable message; the signature covers whatever is sent.
  const body = bodyFor(w.format, d.payload as { type: string }, canonicalJson(d.payload));
  const result = await send(w.url, signedHeaders(secrets, d.messageId, Math.floor(signedAt.getTime() / 1000), body), body);

  const finished = now();
  const ok = isSuccess(result.statusCode);
  const attempts = d.attempts + 1;
  const retryAt = ok || result.statusCode === 410 ? null : nextAttemptAt(attempts, finished, random);

  await prisma.$transaction(async (tx) => {
    // Several deliveries to one endpoint can finish at once: lock it, then read its failure streak.
    await tx.$queryRaw`SELECT id FROM "Webhook" WHERE id = ${w.id}::uuid FOR UPDATE`;
    const current = await tx.webhook.findUniqueOrThrow({ where: { id: w.id }, select: { consecutiveFailures: true, failingSince: true, active: true } });
    const health = afterAttempt(current, result.statusCode, finished);
    const disable = current.active ? health.disable : null;
    await tx.webhookAttempt.create({
      data: { deliveryId: d.id, attemptedAt: signedAt, durationMs: result.durationMs, statusCode: result.statusCode, error: result.error, responseBody: result.body },
    });
    await tx.webhookDelivery.update({
      where: { id: d.id },
      data: {
        attempts,
        lockedUntil: null,
        lastAttemptAt: signedAt,
        lastStatusCode: result.statusCode,
        lastError: result.error,
        ...(ok ? { status: "succeeded", deliveredAt: finished } : retryAt ? { nextAttemptAt: retryAt } : { status: "failed" }),
      },
    });
    await tx.webhook.update({
      where: { id: w.id },
      data: { consecutiveFailures: health.consecutiveFailures, failingSince: health.failingSince, ...(disable ? { active: false, disabledReason: disable } : {}) },
    });
    if (disable) {
      await appendAudit(tx, { eventId: w.eventId, actorLabel: "system:webhooks", action: "webhook.disabled", entityType: "Webhook", entityId: w.id, after: { reason: disable, url: w.url } });
    }
  }, { maxWait: 10_000 });
  return ok;
}

/** One pass: send everything that's due. Returns how many deliveries were attempted. */
export async function runWebhookWorkerOnce(opts: { send?: Sender; now?: () => Date; random?: () => number; limit?: number } = {}): Promise<number> {
  const now = opts.now ?? (() => new Date());
  const ids = await claim(now(), opts.limit ?? BATCH);
  // A few at a time, so one slow endpoint doesn't hold up the rest of the batch.
  const queue = [...ids];
  const lane = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      await attempt(id, opts.send ?? httpSend, now, opts.random ?? Math.random).catch((err: unknown) => console.error("[webhooks] attempt failed", id, err));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, lane));
  return ids.length;
}

/** Old deliveries in a final state are removed; the audit log keeps the record of configuration changes. */
export async function pruneDeliveries(now = new Date()) {
  const { count } = await prisma.webhookDelivery.deleteMany({ where: { status: { in: ["succeeded", "failed"] }, createdAt: { lt: new Date(now.getTime() - KEEP_DAYS * 86_400_000) } } });
  return count;
}

export function startWebhookWorker(intervalMs = 2000): () => void {
  let running = false;
  let lastPrune = 0;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      // Keep going while there's a backlog; otherwise wait for the next tick.
      while ((await runWebhookWorkerOnce()) === BATCH);
      if (Date.now() - lastPrune > 3_600_000) {
        lastPrune = Date.now();
        await pruneDeliveries();
      }
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientInitializationError)) console.error("[webhooks] worker error", err);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  return () => clearInterval(timer);
}
