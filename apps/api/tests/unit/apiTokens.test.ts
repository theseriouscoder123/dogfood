import { describe, expect, it } from "vitest";
import { API_TOKEN_PREFIX, displayPrefix, isApiToken, newApiToken, scopeNeeded, tokenAllows, tokenState } from "../../src/auth/apiTokens";
import { sha256 } from "../../src/lib/crypto";
import { FixedWindowLimiter } from "../../src/lib/rateLimit";

describe("API tokens", () => {
  it("are prefixed, random, and stored only as a hash", () => {
    const a = newApiToken();
    const b = newApiToken();
    expect(a.token.startsWith(API_TOKEN_PREFIX)).toBe(true);
    expect(a.token).toHaveLength(API_TOKEN_PREFIX.length + 43); // 32 random bytes, base64url
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).toBe(sha256(a.token));
    expect(a.tokenHash).not.toContain(a.token);
  });

  it("show only a short prefix", () => {
    const { token, prefix } = newApiToken();
    expect(prefix).toBe(displayPrefix(token));
    expect(prefix).toHaveLength(10);
    expect(token.startsWith(prefix)).toBe(true);
  });

  it("are told apart from session tokens by their prefix", () => {
    expect(isApiToken(newApiToken().token)).toBe(true);
    expect(isApiToken("seed-organizer")).toBe(false);
  });

  it("need read for safe methods and write for everything else", () => {
    expect(["GET", "HEAD", "OPTIONS", "get"].map(scopeNeeded)).toEqual(["read", "read", "read", "read"]);
    expect(["POST", "PUT", "PATCH", "DELETE"].map(scopeNeeded)).toEqual(["write", "write", "write", "write"]);
    expect(tokenAllows(["read"], "GET")).toBe(true);
    expect(tokenAllows(["read"], "POST")).toBe(false);
    expect(tokenAllows(["write"], "GET")).toBe(false); // scopes are literal; creation always pairs write with read
    expect(tokenAllows(["read", "write"], "DELETE")).toBe(true);
  });

  it("are revoked, expired or active, in that order of precedence", () => {
    const now = new Date("2026-09-28T00:00:00Z");
    const past = new Date("2026-09-27T00:00:00Z");
    const future = new Date("2026-10-01T00:00:00Z");
    expect(tokenState({ expiresAt: null, revokedAt: null }, now)).toBe("active");
    expect(tokenState({ expiresAt: future, revokedAt: null }, now)).toBe("active");
    expect(tokenState({ expiresAt: now, revokedAt: null }, now)).toBe("expired");
    expect(tokenState({ expiresAt: past, revokedAt: past }, now)).toBe("revoked");
  });
});

describe("FixedWindowLimiter", () => {
  it("allows up to the limit per window, then refuses until the window resets", () => {
    let t = 0;
    const l = new FixedWindowLimiter(3, 60_000, () => t);
    expect([1, 2, 3].map(() => l.hit("a").allowed)).toEqual([true, true, true]);
    const refused = l.hit("a");
    expect(refused).toMatchObject({ allowed: false, remaining: 0, limit: 3, resetSeconds: 60 });
    t = 59_000;
    expect(l.hit("a")).toMatchObject({ allowed: false, resetSeconds: 1 });
    t = 60_000;
    expect(l.hit("a")).toMatchObject({ allowed: true, remaining: 2 });
  });

  it("counts each key separately", () => {
    const l = new FixedWindowLimiter(1, 1000, () => 0);
    expect(l.hit("a").allowed).toBe(true);
    expect(l.hit("b").allowed).toBe(true);
    expect(l.hit("a").allowed).toBe(false);
  });
});
