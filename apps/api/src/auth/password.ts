import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

// scrypt from node:crypto: no native addon to compile inside Docker.
const N = 16384, r = 8, p = 1, KEYLEN = 32;

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, n, rr, pp, saltB64, keyB64] = stored.split("$");
  if (scheme !== "scrypt" || !n || !rr || !pp || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n), r: Number(rr), p: Number(pp),
  });
  return timingSafeEqual(actual, expected);
}
