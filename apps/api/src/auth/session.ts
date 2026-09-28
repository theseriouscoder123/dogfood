import type { Request, RequestHandler, Response } from "express";
import { prisma } from "../db";
import { config } from "../config";
import { randomToken, sha256 } from "../lib/crypto";
import { FixedWindowLimiter } from "../lib/rateLimit";
import { HttpError } from "../lib/http";
import { LAST_USED_RESOLUTION_MS, isApiToken, tokenAllows, tokenState } from "./apiTokens";

export const SESSION_COOKIE = "sid";

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + config.sessionTtlDays * 86_400_000);
  await prisma.session.create({ data: { tokenHash: sha256(token), userId, expiresAt } });
  return { token, expiresAt };
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure,
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

/** The session token comes from the cookie, or from "Authorization: Bearer <token>" for API clients. */
export function tokenFrom(cookies: Record<string, string> | undefined, authorization: string | undefined) {
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  return bearer ?? cookies?.[SESSION_COOKIE] ?? null;
}

const tokenLimiter = new FixedWindowLimiter(config.apiTokenRateLimit, 60_000);

function rejectToken(res: Response, status: number, code: string, message: string) {
  res.setHeader("WWW-Authenticate", `Bearer error="${code}"`);
  res.status(status).json({ error: { code, message } });
}

/**
 * Resolves the caller once per request. Handlers read req.actor and never parse cookies themselves.
 * A "dfp_" bearer token is a personal API token: it acts as its owner, limited by its scopes and a
 * per-token rate limit. A bad API token is refused outright rather than treated as anonymous, so a
 * script with a revoked token fails loudly instead of quietly seeing only public data.
 */
export const loadActor: RequestHandler = async (req, res, next) => {
  req.actor = null;
  req.apiToken = null;
  const token = tokenFrom(req.cookies, req.headers.authorization);
  if (token && isApiToken(token)) {
    const row = await prisma.apiToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    const state = row ? tokenState(row) : null;
    if (!row || state !== "active") {
      rejectToken(res, 401, "invalid_token", state ? `This API token has been ${state}.` : "This API token is not valid.");
      return;
    }
    if (!tokenAllows(row.scopes, req.method)) {
      rejectToken(res, 403, "insufficient_scope", `This API token is read-only; ${req.method} needs the "write" scope.`);
      return;
    }
    const limit = tokenLimiter.hit(row.id);
    res.setHeader("RateLimit-Limit", String(limit.limit));
    res.setHeader("RateLimit-Remaining", String(limit.remaining));
    res.setHeader("RateLimit-Reset", String(limit.resetSeconds));
    if (!limit.allowed) {
      res.setHeader("Retry-After", String(limit.resetSeconds));
      res.status(429).json({ error: { code: "rate_limited", message: `This token is limited to ${limit.limit} requests a minute.` } });
      return;
    }
    const now = new Date();
    await prisma.apiToken.updateMany({
      where: { id: row.id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(now.getTime() - LAST_USED_RESOLUTION_MS) } }] },
      data: { lastUsedAt: now, lastUsedIp: req.ip ?? null },
    });
    const { id, email, name, isAdmin } = row.user;
    req.actor = { id, email, name, isAdmin };
    req.apiToken = { id: row.id, name: row.name, scopes: row.scopes };
  } else if (token) {
    const session = await prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (session && session.expiresAt > new Date()) {
      const { id, email, name, isAdmin } = session.user;
      req.actor = { id, email, name, isAdmin };
    }
  }
  next();
};

/**
 * Some actions are for people at a browser, not scripts: managing API tokens (so a leaked token
 * can't mint a longer-lived one), voting and commenting (so a token can't be turned into a bot).
 */
export function requireBrowserSession(req: Request) {
  if (req.apiToken) throw new HttpError(403, "session_required", "API tokens can't do this. Sign in to the portal in a browser instead.");
}
