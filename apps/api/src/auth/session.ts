import type { RequestHandler, Response } from "express";
import { prisma } from "../db";
import { config } from "../config";
import { randomToken, sha256 } from "../lib/crypto";

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

/** Resolves the caller once per request. Handlers read req.actor and never parse cookies themselves. */
export const loadActor: RequestHandler = async (req, _res, next) => {
  req.actor = null;
  const token = tokenFrom(req.cookies, req.headers.authorization);
  if (token) {
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
