import path from "node:path";

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return v === "true" || v === "1";
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  fixturesPath: process.env.FIXTURES_PATH ?? path.resolve(process.cwd(), "../../data/fixtures.json"),
  /** Seed demo passwords and fixed demo sessions. Turn off for a real event. */
  seedDemo: bool("SEED_DEMO", true),
  cookieSecure: bool("COOKIE_SECURE", false),
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS ?? 30),
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "http://localhost:3000",
  /** e.g. smtp://mail:1025 (Mailpit) or smtps://user:pass@smtp.example.org. Unset = log emails to the console. */
  smtpUrl: process.env.SMTP_URL ?? "smtp://localhost:1025",
  mailFrom: process.env.MAIL_FROM ?? "Dogfood <no-reply@dogfood.local>",
  uploadDir: process.env.UPLOAD_DIR ?? path.resolve(process.cwd(), "uploads"),
  uploadMaxBytes: Number(process.env.UPLOAD_MAX_BYTES ?? 5 * 1024 * 1024),
  /** Requests per minute allowed for each API token. */
  apiTokenRateLimit: Number(process.env.API_TOKEN_RATE_LIMIT ?? 600),
};
