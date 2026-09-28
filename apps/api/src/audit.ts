// Append-only, hash-chained audit log. Each row stores
//   hash = sha256(prevHash + canonicalJson(row))
// so editing or deleting any past row breaks every hash after it.
// verifyAuditChain() recomputes the chain; the DB trigger blocks UPDATE/DELETE outright.
import type { Request } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import type { Actor } from "./policy";
import { canonicalJson, sha256 } from "./lib/crypto";
import { enqueueForAudit } from "./webhooks/outbox";
import { notifyForAudit } from "./notifications/notify";

const AUDIT_LOCK_KEY = 7_331_001; // serialises appends so the chain never forks

export type AuditEntry = {
  eventId?: string | null;
  actor?: Actor | null;
  actorLabel?: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  requestId?: string | null;
};

type HashedFields = {
  eventId: string | null;
  actorUserId: string | null;
  actorLabel: string;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  requestId: string | null;
  createdAt: string;
};

const rowHash = (prevHash: string, f: HashedFields) => sha256(prevHash + canonicalJson(f));

const toJson = (v: unknown) => (v === null ? Prisma.DbNull : (v as Prisma.InputJsonValue));

/** Append inside an existing transaction, so the audit row commits or rolls back with the change it describes. */
export async function appendAudit(tx: Prisma.TransactionClient, e: AuditEntry): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`;
  const last = await tx.auditLog.findFirst({ orderBy: { id: "desc" }, select: { hash: true } });
  const prevHash = last?.hash ?? "genesis";
  const createdAt = new Date();
  const fields: HashedFields = {
    eventId: e.eventId ?? null,
    actorUserId: e.actor?.id ?? null,
    actorLabel: e.actorLabel ?? e.actor?.email ?? "anonymous",
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    // round-trip through JSON so the hashed value is exactly what jsonb will hand back
    before: JSON.parse(JSON.stringify(e.before ?? null)),
    after: JSON.parse(JSON.stringify(e.after ?? null)),
    ip: e.ip ?? null,
    requestId: e.requestId ?? null,
    createdAt: createdAt.toISOString(),
  };
  const row = await tx.auditLog.create({
    data: {
      ...fields,
      before: toJson(fields.before),
      after: toJson(fields.after),
      createdAt,
      prevHash,
      hash: rowHash(prevHash, fields),
    },
    select: { id: true },
  });
  // The audit log doubles as the event stream: webhooks are queued here, in the same transaction.
  if (fields.eventId) {
    await enqueueForAudit(tx, fields.eventId, { action: fields.action, entityId: fields.entityId, after: fields.after }, row.id, createdAt);
    await notifyForAudit(tx, { eventId: fields.eventId, action: fields.action, entityId: fields.entityId, actorUserId: fields.actorUserId, after: fields.after });
  }
}

/** Stand-alone append for things that are not part of a larger write (e.g. refused requests). */
export function audit(e: AuditEntry): Promise<void> {
  return prisma.$transaction((tx) => appendAudit(tx, e));
}

/** Actor, IP and request id taken from the HTTP request. */
export function fromRequest(req: Request): Pick<AuditEntry, "actor" | "actorLabel" | "ip" | "requestId"> {
  // Changes made by a script say so in the log, and which token did it.
  const actorLabel = req.actor && req.apiToken ? `${req.actor.email} (API token "${req.apiToken.name}")` : undefined;
  return { actor: req.actor, actorLabel, ip: req.ip ?? null, requestId: req.requestId };
}

export async function verifyAuditChain(): Promise<{ ok: boolean; checked: number; brokenAtId?: string }> {
  let prevHash = "genesis";
  let checked = 0;
  let cursor: bigint | undefined;
  for (;;) {
    const rows = await prisma.auditLog.findMany({
      where: cursor === undefined ? {} : { id: { gt: cursor } },
      orderBy: { id: "asc" },
      take: 1000,
    });
    if (rows.length === 0) return { ok: true, checked };
    for (const r of rows) {
      const expected = rowHash(prevHash, {
        eventId: r.eventId,
        actorUserId: r.actorUserId,
        actorLabel: r.actorLabel,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        before: r.before ?? null,
        after: r.after ?? null,
        ip: r.ip,
        requestId: r.requestId,
        createdAt: r.createdAt.toISOString(),
      });
      if (r.prevHash !== prevHash || r.hash !== expected) return { ok: false, checked, brokenAtId: r.id.toString() };
      prevHash = r.hash;
      checked++;
    }
    cursor = rows[rows.length - 1]!.id;
  }
}
