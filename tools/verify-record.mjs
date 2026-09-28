#!/usr/bin/env node
// Verify a Dogfood signed record without trusting the portal's own "valid" badge.
// Needs only Node 18+ (no packages).
//
//   node tools/verify-record.mjs dogfood-record-<id>.json            # a downloaded record
//   node tools/verify-record.mjs http://localhost:8080/verify/<id>    # fetch it by its link
//   node tools/verify-record.mjs <file|url> --key issuer-key.pem      # pin the issuer's key (best)
//   node tools/verify-record.mjs <file|url> --openssl out/            # also write files for openssl
//
// Without --key, the public key is fetched from the issuer (keysUrl in the record). That proves the
// record wasn't altered since that server signed it; pinning a key you obtained separately also
// proves who that server is.
import { createPublicKey, verify } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** Sorted-key JSON: the exact text that was signed (must match the portal's lib/crypto.ts). */
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
    .join(",")}}`;
}

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const keyFile = flag("--key");
const opensslDir = flag("--openssl");
const source = args[0];
if (!source) {
  console.error("usage: node tools/verify-record.mjs <record.json | record URL> [--key key.pem] [--openssl dir]");
  process.exit(2);
}

async function load(src) {
  if (/^https?:\/\//.test(src)) {
    const u = new URL(src);
    const id = u.pathname.split("/").filter(Boolean).pop();
    const res = await fetch(`${u.origin}/api/records/${id}/signed.json`);
    if (!res.ok) throw new Error(`fetching the record failed: HTTP ${res.status}`);
    return res.json();
  }
  return JSON.parse(await readFile(src, "utf8"));
}

const record = await load(source);
if (record.format !== "dogfood-signed-record/v1" || record.alg !== "Ed25519") throw new Error("not a Dogfood signed record");
const text = canonicalJson(record.statement);

let pem;
if (keyFile) {
  pem = await readFile(keyFile, "utf8");
} else {
  const res = await fetch(record.keysUrl);
  const key = (await res.json()).keys.find((k) => k.kid === record.kid);
  if (!key) throw new Error(`the issuer publishes no key ${record.kid}`);
  pem = key.publicKeyPem;
}

const ok = verify(null, Buffer.from(text, "utf8"), createPublicKey(pem), Buffer.from(record.signature, "base64url"));
const s = record.statement;
const kidMatches = s.kid === record.kid;

console.log(`record     ${s.id} (${s.type})`);
console.log(`subject    ${s.subject.name}, ${s.subject.role} at ${s.event.name}`);
console.log(`issued     ${s.issuedAt} by ${s.issuer.name} (${s.issuer.url}), key ${record.kid}${keyFile ? " (pinned)" : " (fetched from issuer)"}`);
console.log(`claims     ${JSON.stringify(s.claims)}`);
console.log(ok && kidMatches ? "\n✓ signature valid: this statement is exactly what the issuer signed." : "\n✗ signature INVALID: the record was altered, or signed by a different key.");
console.log(`  (revocation is checked online: ${s.verify})`);

if (opensslDir) {
  await mkdir(opensslDir, { recursive: true });
  await writeFile(path.join(opensslDir, "statement.txt"), text);
  await writeFile(path.join(opensslDir, "signature.bin"), Buffer.from(record.signature, "base64url"));
  await writeFile(path.join(opensslDir, "key.pem"), pem);
  console.log(`\nwrote ${opensslDir}/statement.txt, signature.bin, key.pem. Check with OpenSSL 3:`);
  console.log(`  openssl pkeyutl -verify -pubin -inkey ${opensslDir}/key.pem -rawin -in ${opensslDir}/statement.txt -sigfile ${opensslDir}/signature.bin`);
}
process.exit(ok && kidMatches ? 0 : 1);
