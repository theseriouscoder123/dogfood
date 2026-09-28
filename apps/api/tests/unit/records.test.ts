import { describe, expect, it } from "vitest";
import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { keyId, signText, verifyText } from "../../src/records/keys";
import { issuable, reviewsDigest } from "../../src/records/issue";
import { canonicalJson } from "../../src/lib/crypto";

describe("Ed25519 signing", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pem = publicKey.export({ type: "spki", format: "pem" }).toString();

  it("verifies what it signed, and nothing else", () => {
    const text = canonicalJson({ subject: { name: "Ada" }, claims: { reviewsSubmitted: 7 } });
    const sig = signText(privateKey, text);
    expect(verifyText(pem, text, sig)).toBe(true);
    expect(verifyText(pem, text.replace("7", "8"), sig)).toBe(false);
    expect(verifyText(generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString(), text, sig)).toBe(false);
    expect(verifyText(pem, text, "not-a-signature")).toBe(false);
  });

  it("names a key by a stable fingerprint of its public half", () => {
    expect(keyId(publicKey)).toMatch(/^[0-9a-f]{16}$/);
    expect(keyId(createPublicKey(pem))).toBe(keyId(publicKey));
    expect(keyId(generateKeyPairSync("ed25519").publicKey)).not.toBe(keyId(publicKey));
  });

  it("signs the canonical form, so key order in storage can't break a signature", () => {
    const sig = signText(privateKey, canonicalJson({ b: 1, a: { d: 2, c: 3 } }));
    expect(verifyText(pem, canonicalJson({ a: { c: 3, d: 2 }, b: 1 }), sig)).toBe(true);
  });
});

describe("reviews digest", () => {
  const reviews = [
    { id: "r2", projectId: "p1", submittedAt: new Date("2026-09-28T10:00:00Z"), scores: { quality: 4 } },
    { id: "r1", projectId: "p2", submittedAt: new Date("2026-09-28T09:00:00Z"), scores: { quality: 2 } },
  ];

  it("ignores the order reviews are listed in", () => {
    expect(reviewsDigest(reviews)).toBe(reviewsDigest([...reviews].reverse()));
    expect(reviewsDigest(reviews)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("changes if any score changes", () => {
    expect(reviewsDigest([{ ...reviews[0]!, scores: { quality: 5 } }, reviews[1]!])).not.toBe(reviewsDigest(reviews));
  });
});

describe("when records can be issued", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  const base = { submissionsCloseAt: new Date("2026-09-29T18:00:00Z"), judgingOpensAt: new Date("2026-09-29T18:00:00Z") };
  it("after judging closes", () => {
    expect(issuable({ ...base, judgingClosesAt: new Date("2026-10-08T00:00:00Z") }, now)).toBe(false);
    expect(issuable({ ...base, judgingClosesAt: new Date("2026-09-30T00:00:00Z") }, now)).toBe(true);
  });
  it("or, with no judging end date, after submissions close", () => {
    expect(issuable({ ...base, judgingOpensAt: null, judgingClosesAt: null }, now)).toBe(true);
    expect(issuable({ ...base, judgingOpensAt: null, judgingClosesAt: null }, new Date("2026-09-29T00:00:00Z"))).toBe(false);
  });
});
