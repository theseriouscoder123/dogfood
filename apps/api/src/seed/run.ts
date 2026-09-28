// Runs on every container start (after migrations). Safe to repeat:
// accounts are upserted, the fixture import is skipped if already done,
// and demo sessions are recreated or removed according to SEED_DEMO.
import { readFile } from "node:fs/promises";
import { prisma } from "../db";
import { config } from "../config";
import { hashPassword } from "../auth/password";
import { sha256 } from "../lib/crypto";
import { importFixtures } from "./importFixtures";
import { seedShowcase } from "./showcase";
import { DEMO_JUDGE_EMAIL, DEMO_VOTER_EMAIL, JUDGING_DEMO_SLUG, seedJudgingDemo } from "./judgingDemo";
import { enqueuePing } from "../webhooks/outbox";
import { issuable, issueRecords } from "../records/issue";

const DEMO_PASSWORD = "dogfood2026";
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "admin@dogfood.local").toLowerCase();
const ORGANIZER_EMAIL = "organizer@dogfood.local";

// Fixed tokens so the acceptance checker and teammates can use known headers.
// judge_a and judge_b share projects and a track, so only peer isolation separates them.
const DEMO_SESSIONS = [
  { label: "organizer", token: "seed-organizer", who: { email: ORGANIZER_EMAIL } },
  { label: "judge_a", token: "seed-judge-a", who: { judge: "jdg_24" } },
  { label: "judge_b", token: "seed-judge-b", who: { judge: "jdg_26" } },
  { label: "participant", token: "seed-participant", who: { email: "priya1@example.org" } },
  { label: "admin", token: "seed-admin", who: { email: ADMIN_EMAIL } },
  // Not used by the checker: a judge with live work in the "spring-build-sprint" demo event.
  { label: "judge_demo", token: "seed-judge-demo", who: { email: DEMO_JUDGE_EMAIL } },
  // A verified community voter who hasn't voted yet in "spring-build-sprint".
  { label: "voter", token: "seed-voter", who: { email: DEMO_VOTER_EMAIL } },
] as const;

// A read-only API token for the organizer, so the API docs' curl examples work out of the box.
const DEMO_API_TOKEN = "dfp_demo-organizer-read-only";

// Two endpoints on the demo receiver (the "hooks" service): one healthy, one down, so the delivery
// log shows successes, retries and backoff. The receiver verifies with the same secret.
const DEMO_WEBHOOK_SECRET = process.env.DEMO_WEBHOOK_SECRET ?? "whsec_ZGVtby1vbmx5LXdlYmhvb2stc2VjcmV0IQ==";
const DEMO_RECEIVER = "http://hooks:9000/hooks/";

async function seedDemoWebhooks(createdById: string) {
  const event = await prisma.event.findUnique({ where: { slug: JUDGING_DEMO_SLUG } });
  if (!event || (await prisma.webhook.count({ where: { eventId: event.id, url: { startsWith: DEMO_RECEIVER } } })) > 0) return;
  await prisma.$transaction(async (tx) => {
    for (const w of [
      { url: `${DEMO_RECEIVER}ok`, description: "Team chat relay (demo receiver, http://localhost:9000)", eventTypes: [] },
      { url: `${DEMO_RECEIVER}down`, description: "CRM sync (down on purpose, to show retries)", eventTypes: ["project.submitted", "results.published"] },
    ]) {
      const hook = await tx.webhook.create({ data: { ...w, eventId: event.id, secret: DEMO_WEBHOOK_SECRET, createdById } });
      await enqueuePing(tx, hook, hook.id);
    }
  });
}

async function main() {
  const fixture = JSON.parse(await readFile(config.fixturesPath, "utf8"));
  const demoHash = config.seedDemo ? await hashPassword(DEMO_PASSWORD) : null;
  const adminHash = process.env.ADMIN_PASSWORD ? await hashPassword(process.env.ADMIN_PASSWORD) : demoHash;

  await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: process.env.ADMIN_PASSWORD ? { passwordHash: adminHash, isAdmin: true } : {},
    create: { email: ADMIN_EMAIL, name: "Portal Admin", isAdmin: true, passwordHash: adminHash },
  });
  const organizer = await prisma.user.upsert({
    where: { email: ORGANIZER_EMAIL },
    update: {},
    create: { email: ORGANIZER_EMAIL, name: "Event Organizer", passwordHash: demoHash },
  });

  const { event, created, summary } = await importFixtures(prisma, fixture, { demoPasswordHash: demoHash, actorLabel: "system:seed" });
  await prisma.eventRole.upsert({
    where: { eventId_userId_role: { eventId: event.id, userId: organizer.id, role: "organizer" } },
    update: {},
    create: { eventId: event.id, userId: organizer.id, role: "organizer" },
  });

  if (process.env.SEED_SHOWCASE !== "false") {
    await seedShowcase(prisma, event.id, organizer.id);
    await seedJudgingDemo(prisma, organizer.id, demoHash);
    // The sample event's judging is over and its results are public: sign its records and certificates.
    const sample = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    if (issuable(sample) && (await prisma.signedRecord.count({ where: { eventId: sample.id } })) === 0) {
      const r = await issueRecords(sample, { actorLabel: "system:seed" });
      console.log(`signed ${r.issued} records and certificates for "${sample.slug}"`);
    }
  }

  if (created && summary) {
    console.log(`imported "${event.name}" (${event.slug}): ${summary.projects} projects, ${summary.judges} judges, ${summary.reviews} reviews, criteria ${summary.criteria.join("/")}`);
    for (const d of summary.duplicates) console.log(`  duplicate flagged: ${d.project} duplicates ${d.duplicateOf} (${d.reason})`);
  } else {
    console.log(`fixtures already imported as "${event.slug}", skipping`);
  }

  if (!config.seedDemo) {
    const { count } = await prisma.session.deleteMany({ where: { seeded: true } });
    const tokens = await prisma.apiToken.deleteMany({ where: { seeded: true } });
    const hooks = await prisma.webhook.deleteMany({ where: { url: { startsWith: DEMO_RECEIVER } } });
    console.log(`SEED_DEMO=false: removed ${count} demo sessions, ${tokens.count} demo API tokens and ${hooks.count} demo webhooks`);
    return;
  }

  const lines: string[] = [];
  for (const s of DEMO_SESSIONS) {
    const user =
      "email" in s.who
        ? await prisma.user.findUnique({ where: { email: s.who.email } })
        : (await prisma.eventRole.findFirst({ where: { eventId: event.id, role: "judge", externalId: s.who.judge }, include: { user: true } }))?.user;
    if (!user) {
      console.warn(`  demo login "${s.label}" skipped: its user is not in the fixture data`);
      continue;
    }
    await prisma.session.upsert({
      where: { tokenHash: sha256(s.token) },
      update: { userId: user.id, expiresAt: new Date("2099-01-01T00:00:00Z"), seeded: true },
      create: { tokenHash: sha256(s.token), userId: user.id, expiresAt: new Date("2099-01-01T00:00:00Z"), seeded: true },
    });
    lines.push(`  ${s.label.padEnd(12)} Cookie: sid=${s.token.padEnd(18)} ${user.email}`);
  }
  await prisma.apiToken.upsert({
    where: { tokenHash: sha256(DEMO_API_TOKEN) },
    update: { userId: organizer.id, revokedAt: null, expiresAt: null, scopes: ["read"], seeded: true },
    create: { tokenHash: sha256(DEMO_API_TOKEN), prefix: DEMO_API_TOKEN.slice(0, 10), name: "Demo (read-only)", userId: organizer.id, scopes: ["read"], seeded: true },
  });
  await seedDemoWebhooks(organizer.id);
  lines.push(`  ${"api token".padEnd(12)} Authorization: Bearer ${DEMO_API_TOKEN}   organizer, read-only`);
  console.log(["", "seeded. test logins:", ...lines, `  password for every seeded account: ${DEMO_PASSWORD}`, ""].join("\n"));
}

main()
  .catch((err) => {
    console.error("seed failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
