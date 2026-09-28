// Personal API tokens: the rules that don't need a database, kept pure so they're unit-tested.
import { randomToken, sha256 } from "../lib/crypto";

/** Every token starts with this, so secret scanners and log filters can recognise a leaked one. */
export const API_TOKEN_PREFIX = "dfp_";

export const API_SCOPES = ["read", "write"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

/** Choices offered when creating a token; null = never expires. */
export const TOKEN_LIFETIMES_DAYS = [7, 30, 90, 365, null] as const;
export const MAX_ACTIVE_TOKENS = 25;

export const isApiToken = (token: string) => token.startsWith(API_TOKEN_PREFIX);

export function newApiToken(): { token: string; prefix: string; tokenHash: string } {
  const token = `${API_TOKEN_PREFIX}${randomToken(32)}`;
  return { token, prefix: displayPrefix(token), tokenHash: sha256(token) };
}

/** Enough of the token to recognise it in a list, far too little to use it. */
export const displayPrefix = (token: string) => token.slice(0, API_TOKEN_PREFIX.length + 6);

/** Reading never changes anything, so it only needs "read". Every other method needs "write". */
export function scopeNeeded(method: string): ApiScope {
  return ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase()) ? "read" : "write";
}

export const tokenAllows = (scopes: readonly string[], method: string) => scopes.includes(scopeNeeded(method));

export type TokenState = "active" | "expired" | "revoked";

export function tokenState(t: { expiresAt: Date | null; revokedAt: Date | null }, now = new Date()): TokenState {
  if (t.revokedAt) return "revoked";
  if (t.expiresAt && t.expiresAt <= now) return "expired";
  return "active";
}

/** lastUsedAt is refreshed at most this often, so a busy script doesn't turn every read into a write. */
export const LAST_USED_RESOLUTION_MS = 60_000;
