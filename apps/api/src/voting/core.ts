// Pure helpers for community voting: identity keys, ballot order, receipts. No I/O.
import { createHash, randomBytes } from "node:crypto";
import { rng } from "../judging/assign";

// Providers where dots in the local part are ignored (john.smith@ and johnsmith@ are one inbox).
const DOTLESS = new Set(["gmail.com", "googlemail.com"]);

/**
 * The inbox an address really delivers to, for "one inbox, one ballot". Lower-cases, drops a
 * "+tag" (supported by Gmail, Outlook, Fastmail, Proton and most others) and, for Gmail, dots.
 * Deliberately conservative: two different people never collapse into one key, but the common
 * ways of minting extra addresses from one inbox do.
 */
export function normalizeEmail(email: string): string {
  const [rawLocal = "", rawDomain = ""] = email.trim().toLowerCase().split(/@(?=[^@]*$)/);
  let domain = rawDomain;
  let local = rawLocal.split("+")[0]!;
  if (DOTLESS.has(domain)) {
    local = local.replace(/\./g, "");
    domain = "gmail.com";
  }
  return `${local}@${domain}`;
}

/** "company.com" allows alice@company.com and bob@eng.company.com. An empty list allows anyone. */
export function emailDomainAllowed(email: string, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  const domain = email.trim().toLowerCase().split("@").pop() ?? "";
  return allowed.some((d) => {
    const want = d.trim().toLowerCase().replace(/^@/, "");
    return domain === want || domain.endsWith(`.${want}`);
  });
}

/**
 * This voter's ballot order: a Fisher–Yates shuffle seeded by the voter's identity, so it is the
 * same every time they open the ballot but independent between voters. Nobody gains from being
 * listed first, and the order can be reproduced later to audit where each project was shown.
 */
export function ballotOrder<T extends string>(projectIds: T[], seedKey: string): T[] {
  const seed = parseInt(createHash("sha256").update(seedKey).digest("hex").slice(0, 8), 16);
  const random = rng(seed);
  const out = [...projectIds].sort();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// No 0/O, 1/I/L, so a receipt read aloud or copied by hand survives.
const RECEIPT_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** A voter's receipt, e.g. "DF-7K3P-Q9XM": ~50 bits, enough that nobody can guess someone else's. */
export function makeReceipt(): string {
  const bytes = randomBytes(10);
  const chars = [...bytes].map((b) => RECEIPT_ALPHABET[b % RECEIPT_ALPHABET.length]).join("");
  return `DF-${chars.slice(0, 5)}-${chars.slice(5, 10)}`;
}

/** Single-use ballot code for invite-mode events, e.g. "VOTE-4KX9-PM2Q-T7HD". */
export function makeInviteCode(): string {
  const bytes = randomBytes(12);
  const chars = [...bytes].map((b) => RECEIPT_ALPHABET[b % RECEIPT_ALPHABET.length]).join("");
  return `VOTE-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

/** Codes are typed by hand, so compare them case- and dash-insensitively. */
export const canonicalCode = (code: string) => code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
