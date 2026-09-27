// Spam and safety rules for project comments. Pure, so they're unit-tested directly.

export const MAX_LENGTH = 2000;
export const EDIT_WINDOW_MS = 15 * 60_000;
export const BURST = { count: 5, windowMs: 10 * 60_000 }; // at most 5 comments in 10 minutes
export const DAILY = { count: 30, windowMs: 24 * 3_600_000 }; // and 30 a day
export const LINKS_MIN_ACCOUNT_AGE_MS = 24 * 3_600_000; // brand-new accounts can't post links
export const AUTO_HIDE_REPORTS = 3; // distinct reporters (with accounts older than a day) hide a comment pending review
export const TRUSTED_REPORTER_AGE_MS = 24 * 3_600_000;

// A URL, a www. address, or a bare domain on a common TLD ("win-prizes.xyz").
const LINK = /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]{2,}\.(?:com|net|org|io|dev|app|xyz|co|ly|gg|me|info|biz|site|online|link|click|top)\b/i;

export const containsLink = (body: string) => LINK.test(body);

/** Two comments are "the same" if they only differ in case, spacing and punctuation. */
export const fingerprintBody = (body: string) =>
  body
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export const withinEditWindow = (createdAt: Date, now = new Date()) => now.getTime() - createdAt.getTime() <= EDIT_WINDOW_MS;
