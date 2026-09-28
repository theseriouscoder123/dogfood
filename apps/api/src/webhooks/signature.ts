// Webhook signatures, following the Standard Webhooks spec (https://www.standardwebhooks.com),
// so receivers can verify with an off-the-shelf library as well as with verifyWebhook() below.
//
//   webhook-id:        the message id (the same on every retry)
//   webhook-timestamp: unix seconds when this attempt was signed
//   webhook-signature: "v1,<base64 HMAC-SHA256 of `${id}.${timestamp}.${body}`>", space-separated
//                      when two secrets are live during a rotation
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SECRET_PREFIX = "whsec_";
/** Receivers should reject messages signed more than this long ago (replay protection). */
export const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

export const newWebhookSecret = () => `${SECRET_PREFIX}${randomBytes(24).toString("base64")}`;

function keyOf(secret: string): Buffer {
  if (!secret.startsWith(SECRET_PREFIX)) throw new Error("Webhook secrets start with whsec_");
  return Buffer.from(secret.slice(SECRET_PREFIX.length), "base64");
}

export function sign(secret: string, msgId: string, timestamp: number, body: string): string {
  return `v1,${createHmac("sha256", keyOf(secret)).update(`${msgId}.${timestamp}.${body}`).digest("base64")}`;
}

/** The three headers for one attempt. Every live secret signs, so receivers on either secret accept it. */
export function signedHeaders(secrets: string[], msgId: string, timestamp: number, body: string): Record<string, string> {
  return {
    "webhook-id": msgId,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": secrets.map((s) => sign(s, msgId, timestamp, body)).join(" "),
  };
}

export type VerifyResult = { ok: true } | { ok: false; reason: "missing_headers" | "timestamp_out_of_range" | "bad_signature" };

/** What a receiver does: check the timestamp is recent, then look for one matching signature. */
export function verifyWebhook(secret: string, headers: Record<string, string | string[] | undefined>, body: string, nowSeconds = Math.floor(Date.now() / 1000)): VerifyResult {
  const one = (h: string) => {
    const v = headers[h];
    return Array.isArray(v) ? v[0] : v;
  };
  const id = one("webhook-id");
  const ts = Number(one("webhook-timestamp"));
  const sigs = one("webhook-signature");
  if (!id || !sigs || !Number.isInteger(ts)) return { ok: false, reason: "missing_headers" };
  if (Math.abs(nowSeconds - ts) > TIMESTAMP_TOLERANCE_SECONDS) return { ok: false, reason: "timestamp_out_of_range" };
  const expected = Buffer.from(sign(secret, id, ts, body));
  const match = sigs.split(" ").some((s) => {
    const given = Buffer.from(s);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  return match ? { ok: true } : { ok: false, reason: "bad_signature" };
}
