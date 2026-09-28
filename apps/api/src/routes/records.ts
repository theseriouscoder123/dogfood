// Signed records: organizers issue and revoke them; anyone with a record's id can verify it.
//   /api/events/:slug/records…   organizer
//   /api/records/…               public (keys, one record), or signed in (mine)
import { Router, type Request } from "express";
import { z } from "zod";
import type { SignedRecord } from "@prisma/client";
import { prisma } from "../db";
import { config } from "../config";
import { accessFor, decideOrganize, enforce } from "../policy";
import { appendAudit, fromRequest } from "../audit";
import { eventBySlug } from "../lib/events";
import { canonicalJson } from "../lib/crypto";
import { HttpError, notFound, unauthenticated } from "../lib/http";
import { issuable, issueRecords } from "../records/issue";
import { verifyText } from "../records/keys";

export const recordsAdminRouter = Router({ mergeParams: true });
export const recordsRouter = Router();

export const RevokeRecordBody = z.object({ reason: z.string().trim().min(5, "Say why (at least 5 characters).").max(300) });

const statusOf = (r: Pick<SignedRecord, "revokedAt" | "supersededById">) => (r.revokedAt ? "revoked" : r.supersededById ? "superseded" : "current");

async function staffEvent(req: Request) {
  const event = await eventBySlug((req.params as { slug?: string }).slug);
  enforce(decideOrganize(await accessFor(req.actor, event.id)));
  return event;
}

const summary = (r: SignedRecord & { user?: { name: string; email: string } }) => {
  const s = r.statement as { subject?: { name?: string }; claims?: Record<string, unknown> };
  return {
    id: r.id,
    type: r.type,
    status: statusOf(r),
    subject: r.user ? { name: r.user.name, email: r.user.email } : { name: s.subject?.name ?? "" },
    claims: s.claims ?? {},
    kid: r.kid,
    issuedAt: r.issuedAt,
    revokedAt: r.revokedAt,
    revokedReason: r.revokedReason,
    supersededById: r.supersededById,
  };
};

recordsAdminRouter.get("/records", async (req, res) => {
  const event = await staffEvent(req);
  const records = await prisma.signedRecord.findMany({ where: { eventId: event.id }, orderBy: [{ type: "asc" }, { issuedAt: "desc" }], include: { user: { select: { name: true, email: true } } } });
  res.json({
    issuable: issuable(event),
    judgingClosesAt: event.judgingClosesAt,
    resultsPublished: event.publishedRunId !== null,
    peoplesChoicePublished: event.votingPublishedAt !== null,
    records: records.map(summary),
  });
});

recordsAdminRouter.post("/records/issue", async (req, res) => {
  const event = await staffEvent(req);
  if (!issuable(event)) throw new HttpError(409, "judging_not_closed", "Records can be issued once judging has closed, so they describe the final picture.");
  res.status(201).json(await issueRecords(event, fromRequest(req)));
});

recordsAdminRouter.post("/records/:recordId/revoke", async (req, res) => {
  const event = await staffEvent(req);
  const { reason } = RevokeRecordBody.parse(req.body);
  const id = (req.params as { recordId: string }).recordId;
  const r = z.uuid().safeParse(id).success ? await prisma.signedRecord.findFirst({ where: { id, eventId: event.id } }) : null;
  if (!r) throw notFound("Record");
  if (r.revokedAt) throw new HttpError(409, "already_revoked", "This record is already revoked.");
  await prisma.$transaction(async (tx) => {
    await tx.signedRecord.update({ where: { id: r.id }, data: { revokedAt: new Date(), revokedReason: reason } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "record.revoked", entityType: "SignedRecord", entityId: r.id, after: { reason } });
  });
  res.json({ ok: true });
});

// ── public ──────────────────────────────────────────────────────────────────

/** Every public key that has signed records, current and retired. */
recordsRouter.get("/keys", async (_req, res) => {
  const keys = await prisma.signingKey.findMany({ orderBy: { createdAt: "asc" } });
  res.json({ keys: keys.map((k) => ({ kid: k.kid, alg: "Ed25519", publicKeyPem: k.publicKeyPem, createdAt: k.createdAt, retiredAt: k.retiredAt })) });
});

/** The signed-in person's own records, across events. */
recordsRouter.get("/mine", async (req, res) => {
  if (!req.actor) throw unauthenticated();
  const records = await prisma.signedRecord.findMany({ where: { userId: req.actor.id, supersededById: null }, orderBy: { issuedAt: "desc" }, include: { event: { select: { slug: true, name: true, logoUrl: true } } } });
  res.json({ records: records.map((r) => ({ ...summary(r), event: r.event })) });
});

async function loadRecord(req: Request) {
  const id = (req.params as { recordId: string }).recordId;
  const r = z.uuid().safeParse(id).success ? await prisma.signedRecord.findUnique({ where: { id }, include: { key: true, event: { select: { slug: true, logoUrl: true, bannerUrl: true } } } }) : null;
  if (!r) throw notFound("Record");
  return r;
}

/**
 * One record, for the verification page. signedText is exactly the bytes that were signed, so a
 * client can check the signature itself (the page does, with WebCrypto) instead of trusting
 * signatureValid.
 */
recordsRouter.get("/:recordId", async (req, res) => {
  const r = await loadRecord(req);
  const signedText = canonicalJson(r.statement);
  const signatureValid = verifyText(r.key.publicKeyPem, signedText, r.signature);
  res.json({
    status: signatureValid ? statusOf(r) : "invalid",
    signatureValid,
    statement: r.statement,
    signedText,
    signature: r.signature,
    key: { kid: r.key.kid, alg: "Ed25519", publicKeyPem: r.key.publicKeyPem, retiredAt: r.key.retiredAt },
    revokedAt: r.revokedAt,
    revokedReason: r.revokedReason,
    supersededById: r.supersededById,
    event: r.event,
  });
});

/** The portable form: statement and signature, to verify offline (tools/verify-record.mjs, or openssl). */
recordsRouter.get("/:recordId/signed.json", async (req, res) => {
  const r = await loadRecord(req);
  res.setHeader("Content-Disposition", `attachment; filename="dogfood-record-${r.id}.json"`);
  res.json({ format: "dogfood-signed-record/v1", alg: "Ed25519", kid: r.kid, keysUrl: `${config.publicBaseUrl}/api/records/keys`, statement: r.statement, signature: r.signature });
});
