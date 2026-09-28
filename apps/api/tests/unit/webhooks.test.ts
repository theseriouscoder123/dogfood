import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { newWebhookSecret, sign, signedHeaders, verifyWebhook } from "../../src/webhooks/signature";
import { DISABLE_AFTER_FAILURES, MAX_ATTEMPTS, RETRY_DELAYS_MS, afterAttempt, nextAttemptAt } from "../../src/webhooks/retry";
import { checkWebhookUrl, isPrivateAddress } from "../../src/webhooks/address";
import { PING_TYPE, WEBHOOK_EVENTS, WEBHOOK_EVENT_TYPES, subscribes, typeForAction } from "../../src/webhooks/catalog";

describe("signatures (Standard Webhooks)", () => {
  // The worked example from the Standard Webhooks spec's reference implementations.
  it("matches the spec's published test vector", () => {
    const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
    const body = '{"test": 2432232314}';
    expect(sign(secret, "msg_p5jXN8AQM9LWM0D4loKWxJek", 1614265330, body)).toBe("v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=");
  });

  it("is HMAC-SHA256 over id.timestamp.body with the decoded secret", () => {
    const secret = newWebhookSecret();
    const key = Buffer.from(secret.slice("whsec_".length), "base64");
    const expected = createHmac("sha256", key).update("evt_1.1700000000.{}").digest("base64");
    expect(sign(secret, "evt_1", 1700000000, "{}")).toBe(`v1,${expected}`);
  });

  it("verifies a genuine delivery and rejects tampering, replays and wrong secrets", () => {
    const secret = newWebhookSecret();
    const body = JSON.stringify({ id: "evt_7", type: "project.submitted" });
    const now = 1_800_000_000;
    const headers = signedHeaders([secret], "evt_7", now, body);
    expect(verifyWebhook(secret, headers, body, now)).toEqual({ ok: true });
    expect(verifyWebhook(secret, headers, body.replace("7", "8"), now)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyWebhook(newWebhookSecret(), headers, body, now)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyWebhook(secret, headers, body, now + 301)).toEqual({ ok: false, reason: "timestamp_out_of_range" });
    expect(verifyWebhook(secret, { ...headers, "webhook-id": "evt_other" }, body, now)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyWebhook(secret, {}, body, now)).toEqual({ ok: false, reason: "missing_headers" });
  });

  it("signs with both secrets during a rotation, so either one verifies", () => {
    const [oldS, newS] = [newWebhookSecret(), newWebhookSecret()];
    const headers = signedHeaders([newS, oldS], "evt_9", 100, "{}");
    expect(headers["webhook-signature"]!.split(" ")).toHaveLength(2);
    expect(verifyWebhook(oldS, headers, "{}", 100).ok).toBe(true);
    expect(verifyWebhook(newS, headers, "{}", 100).ok).toBe(true);
  });
});

describe("retry schedule", () => {
  const t0 = new Date("2026-09-28T00:00:00Z");
  const mid = () => 0.5; // no jitter

  it("backs off and gives up after the last attempt", () => {
    expect(nextAttemptAt(1, t0, mid)!.getTime() - t0.getTime()).toBe(60_000);
    expect(nextAttemptAt(2, t0, mid)!.getTime() - t0.getTime()).toBe(5 * 60_000);
    expect(nextAttemptAt(MAX_ATTEMPTS - 1, t0, mid)!.getTime() - t0.getTime()).toBe(RETRY_DELAYS_MS.at(-1));
    expect(nextAttemptAt(MAX_ATTEMPTS, t0, mid)).toBeNull();
    expect(RETRY_DELAYS_MS.reduce((a, b) => a + b, 0) / 3_600_000).toBeCloseTo(44.6, 0);
  });

  it("jitters by at most 10% either way", () => {
    expect(nextAttemptAt(1, t0, () => 0)!.getTime() - t0.getTime()).toBe(54_000);
    expect(nextAttemptAt(1, t0, () => 1)!.getTime() - t0.getTime()).toBe(66_000);
  });

  it("disables an endpoint only after a long run of failures, or at once on 410", () => {
    let h = { consecutiveFailures: 0, failingSince: null as Date | null };
    for (let i = 0; i < DISABLE_AFTER_FAILURES + 5; i++) {
      const r = afterAttempt(h, 503, new Date(t0.getTime() + i * 60_000));
      expect(r.disable).toBeNull(); // many failures, but all within minutes: a blip, not a dead endpoint
      h = r;
    }
    expect(h.failingSince).toEqual(t0);
    expect(afterAttempt(h, null, new Date(t0.getTime() + 25 * 3_600_000)).disable).toMatch(/failed attempts in a row/);
    expect(afterAttempt(h, 204, new Date(t0.getTime() + 25 * 3_600_000))).toEqual({ consecutiveFailures: 0, failingSince: null, disable: null });
    expect(afterAttempt({ consecutiveFailures: 0, failingSince: null }, 410, t0).disable).toMatch(/410/);
  });
});

describe("address guard", () => {
  it("knows private, loopback, link-local and mapped addresses", () => {
    for (const a of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.20.0.5", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "not-an-ip"])
      expect(isPrivateAddress(a), a).toBe(true);
    for (const a of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) expect(isPrivateAddress(a), a).toBe(false);
  });

  it("refuses internal targets and embedded credentials, allows public URLs and allow-listed hosts", () => {
    expect(checkWebhookUrl("https://hooks.example.org/in", [])).toBeNull();
    expect(checkWebhookUrl("ftp://example.org", [])).toMatch(/http/);
    expect(checkWebhookUrl("https://user:pw@example.org", [])).toMatch(/credentials/);
    expect(checkWebhookUrl("http://169.254.169.254/latest/meta-data", [])).toMatch(/private/);
    expect(checkWebhookUrl("http://[::1]:4000/", [])).toMatch(/private/);
    expect(checkWebhookUrl("http://localhost:4000/api", [])).toMatch(/own network/);
    expect(checkWebhookUrl("http://db.internal/", [])).toMatch(/own network/);
    expect(checkWebhookUrl("http://hooks:9000/in", ["hooks"])).toBeNull();
    expect(checkWebhookUrl("not a url", [])).toMatch(/valid/);
  });
});

describe("event catalogue", () => {
  it("maps each audit action to at most one webhook type", () => {
    const actions = Object.values(WEBHOOK_EVENTS).flatMap((d) => d.actions);
    expect(new Set(actions).size).toBe(actions.length);
    expect(typeForAction("project.submit")).toBe("project.submitted");
    expect(typeForAction("review.revised")).toBe("review.submitted");
  });

  it("never exposes ballots, API tokens or webhook configuration", () => {
    for (const a of ["ballot.cast", "ballot.changed", "ballots.quarantined", "api_token.created", "webhook.created", "export.downloaded", "auth.password_reset"]) expect(typeForAction(a), a).toBeNull();
    expect(WEBHOOK_EVENT_TYPES.some((t) => t.startsWith("ballot"))).toBe(false);
  });

  it("treats an empty subscription as everything, and always delivers pings", () => {
    expect(subscribes([], "project.submitted")).toBe(true);
    expect(subscribes(["results.published"], "project.submitted")).toBe(false);
    expect(subscribes(["results.published"], PING_TYPE)).toBe(true);
  });
});
