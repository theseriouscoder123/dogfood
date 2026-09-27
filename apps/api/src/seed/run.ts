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
import { DEMO_JUDGE_EMAIL, DEMO_VOTER_EMAIL, seedJudgingDemo } from "./judgingDemo";

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
  }

  if (created && summary) {
    console.log(`imported "${event.name}" (${event.slug}): ${summary.projects} projects, ${summary.judges} judges, ${summary.reviews} reviews, criteria ${summary.criteria.join("/")}`);
    for (const d of summary.duplicates) console.log(`  duplicate flagged: ${d.project} duplicates ${d.duplicateOf} (${d.reason})`);
  } else {
    console.log(`fixtures already imported as "${event.slug}", skipping`);
  }

  if (!config.seedDemo) {
    const { count } = await prisma.session.deleteMany({ where: { seeded: true } });
    console.log(`SEED_DEMO=false: removed ${count} demo sessions`);
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
  console.log(["", "seeded. test logins:", ...lines, `  password for every seeded account: ${DEMO_PASSWORD}`, ""].join("\n"));
}

main()
  .catch((err) => {
    console.error("seed failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
