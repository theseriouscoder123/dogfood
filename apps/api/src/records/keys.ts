// The Ed25519 signing key. The private half is a PEM file (SIGNING_KEY_PATH, mode 0600, on its own
// volume); it's created on first use. Its public half is recorded in SigningKey, keyed by kid, so
// verifiers can fetch it, and records signed by an older key stay verifiable after a rotation
// (replace the file; the next start registers the new key and retires the old one).
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as edSign, verify as edVerify, type KeyObject } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../db";
import { config } from "../config";

export type Signer = { kid: string; publicKeyPem: string; sign: (text: string) => string };

const b64url = (b: Buffer) => b.toString("base64url");

/** A short, stable id for a public key: the first 16 hex characters of the SHA-256 of its DER encoding. */
export function keyId(publicKey: KeyObject): string {
  return createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex").slice(0, 16);
}

export function signText(privateKey: KeyObject, text: string): string {
  return b64url(edSign(null, Buffer.from(text, "utf8"), privateKey));
}

export function verifyText(publicKeyPem: string, text: string, signature: string): boolean {
  try {
    return edVerify(null, Buffer.from(text, "utf8"), createPublicKey(publicKeyPem), Buffer.from(signature, "base64url"));
  } catch {
    return false;
  }
}

async function loadOrCreate(file: string): Promise<KeyObject> {
  try {
    return createPrivateKey(await readFile(file, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    const { privateKey } = generateKeyPairSync("ed25519");
    await mkdir(path.dirname(file), { recursive: true });
    // "wx": never overwrite a key another process wrote a moment ago
    await writeFile(file, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" }).catch(async (e: NodeJS.ErrnoException) => {
      if (e.code !== "EEXIST") throw e;
    });
    await chmod(file, 0o600).catch(() => {});
    return createPrivateKey(await readFile(file, "utf8"));
  }
}

let current: Promise<Signer> | null = null;

/** The signer for this process: loads (or creates) the key file and registers its public key. */
export function getSigner(): Promise<Signer> {
  current ??= (async () => {
    const privateKey = await loadOrCreate(config.signingKeyPath);
    const publicKey = createPublicKey(privateKey);
    const kid = keyId(publicKey);
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    await prisma.$transaction([
      prisma.signingKey.upsert({ where: { kid }, update: { retiredAt: null }, create: { kid, publicKeyPem } }),
      prisma.signingKey.updateMany({ where: { kid: { not: kid }, retiredAt: null }, data: { retiredAt: new Date() } }),
    ]);
    return { kid, publicKeyPem, sign: (text: string) => signText(privateKey, text) };
  })().catch((err) => {
    current = null; // let the next call try again
    throw err;
  });
  return current;
}

/** Tests swap the key file; this forgets the cached signer. */
export function resetSignerForTests() {
  current = null;
}
