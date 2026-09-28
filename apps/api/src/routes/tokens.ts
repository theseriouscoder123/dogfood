// Personal API tokens: list, create (the secret is returned once) and revoke.
// Only a signed-in browser session can manage tokens; see requireBrowserSession.
import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { appendAudit, fromRequest } from "../audit";
import { requireBrowserSession } from "../auth/session";
import { API_SCOPES, MAX_ACTIVE_TOKENS, TOKEN_LIFETIMES_DAYS, newApiToken, tokenState } from "../auth/apiTokens";
import { HttpError, notFound, unauthenticated } from "../lib/http";

export const tokensRouter = Router();

export const CreateTokenBody = z.object({
  name: z.string().trim().min(1).max(60).describe('What the token is for, e.g. "CI results export".'),
  scopes: z
    .array(z.enum(API_SCOPES))
    .min(1)
    .max(2)
    .transform((s) => (s.includes("write") ? ["read", "write"] : ["read"]))
    .describe('"read" allows GET requests only. "write" allows changes too (it always comes with "read").'),
  expiresInDays: z
    .union([z.literal(7), z.literal(30), z.literal(90), z.literal(365), z.null()])
    .default(90)
    .describe("Lifetime in days, or null for a token that never expires."),
});

const DAY = 86_400_000;

function me(req: Request) {
  requireBrowserSession(req);
  if (!req.actor) throw unauthenticated();
  return req.actor;
}

const view = (t: { id: string; name: string; prefix: string; scopes: string[]; expiresAt: Date | null; lastUsedAt: Date | null; lastUsedIp: string | null; revokedAt: Date | null; createdAt: Date }) => ({
  id: t.id,
  name: t.name,
  prefix: t.prefix,
  scopes: t.scopes,
  state: tokenState(t),
  createdAt: t.createdAt,
  expiresAt: t.expiresAt,
  lastUsedAt: t.lastUsedAt,
  lastUsedIp: t.lastUsedIp,
  revokedAt: t.revokedAt,
});

/** The caller's tokens, newest first. Revoked and expired tokens stay listed for 30 days so their history is visible. */
tokensRouter.get("/", async (req, res) => {
  const actor = me(req);
  const since = new Date(Date.now() - 30 * DAY);
  const tokens = await prisma.apiToken.findMany({
    where: { userId: actor.id, OR: [{ revokedAt: null }, { revokedAt: { gt: since } }] },
    orderBy: { createdAt: "desc" },
  });
  res.json({
    tokens: tokens.filter((t) => !t.expiresAt || t.expiresAt > since).map(view),
    limits: { maxActive: MAX_ACTIVE_TOKENS, lifetimesDays: TOKEN_LIFETIMES_DAYS, scopes: API_SCOPES },
  });
});

tokensRouter.post("/", async (req, res) => {
  const actor = me(req);
  const body = CreateTokenBody.parse(req.body);
  const { token, prefix, tokenHash } = newApiToken();
  const created = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id}::uuid FOR UPDATE`; // count and insert as one step
    const active = await tx.apiToken.count({ where: { userId: actor.id, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
    if (active >= MAX_ACTIVE_TOKENS) throw new HttpError(409, "too_many_tokens", `You already have ${MAX_ACTIVE_TOKENS} active tokens. Revoke one you no longer use.`);
    const t = await tx.apiToken.create({
      data: {
        userId: actor.id,
        name: body.name,
        prefix,
        tokenHash,
        scopes: body.scopes,
        expiresAt: body.expiresInDays === null ? null : new Date(Date.now() + body.expiresInDays * DAY),
      },
    });
    await appendAudit(tx, { ...fromRequest(req), action: "api_token.created", entityType: "ApiToken", entityId: t.id, after: { name: t.name, prefix, scopes: t.scopes, expiresAt: t.expiresAt } });
    return t;
  });
  res.status(201).json({ token: view(created), secret: token });
});

/** Revoking is immediate and permanent. Revoking an already-revoked token is a no-op. */
tokensRouter.delete("/:tokenId", async (req, res) => {
  const actor = me(req);
  const { tokenId } = z.object({ tokenId: z.uuid() }).parse(req.params);
  const t = await prisma.apiToken.findFirst({ where: { id: tokenId, userId: actor.id } });
  if (!t) throw notFound("Token");
  if (!t.revokedAt) {
    await prisma.$transaction(async (tx) => {
      await tx.apiToken.update({ where: { id: t.id }, data: { revokedAt: new Date() } });
      await appendAudit(tx, { ...fromRequest(req), action: "api_token.revoked", entityType: "ApiToken", entityId: t.id, before: { name: t.name, prefix: t.prefix } });
    });
  }
  res.status(204).end();
});
