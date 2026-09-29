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
import { seedPairwiseDemo } from "./pairwiseDemo";
import { enqueuePing } from "../webhooks/outbox";
import { issuable, issueRecords } from "../records/issue";
import { notify, type Note } from "../notifications/notify";
import { ensureHandle } from "../users/profile";

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

/** Announcements on the live events, and a lively team finder on the demo jam. Runs once per install. */
async function seedDemoCommunity(organizerId: string, sampleEventId: string) {
  if ((await prisma.announcement.count()) > 0) return;
  const [sprint, jam] = await Promise.all([prisma.event.findUnique({ where: { slug: JUDGING_DEMO_SLUG } }), prisma.event.findUnique({ where: { slug: "dogfood-demo-jam" } })]);
  const ago = (h: number) => new Date(Date.now() - h * 3_600_000);
  if (sprint) {
    await prisma.announcement.createMany({
      data: [
        { eventId: sprint.id, authorId: organizerId, title: "Judging is open", body: "Judges: your queue is on the **Judging** tab. Aim to finish two days before the deadline so we have time for a second look at close calls.", createdAt: ago(40), updatedAt: ago(40) },
        { eventId: sprint.id, authorId: organizerId, title: "People's Choice voting is live", body: "Everyone can vote for up to three projects. Voting closes when judging does. Results go up after we review the ballots.", pinned: true, createdAt: ago(30), updatedAt: ago(30) },
      ],
    });
  }
  if (jam) {
    await prisma.announcement.createMany({
      data: [
        { eventId: jam.id, authorId: organizerId, title: "Welcome, builders", body: "Form a team of up to four (or go solo), then start your project from the **My team** tab. Use **Find a team** if you're looking for people.", pinned: true, createdAt: ago(20), updatedAt: ago(20) },
        { eventId: jam.id, authorId: organizerId, title: "Mentor office hours", body: "Mentors are on call every evening 18:00–20:00 UTC. Bring a question, a bug, or a half-formed idea.", createdAt: ago(6), updatedAt: ago(6) },
      ],
    });
    // A few sample-event builders looking for teams, and one team with room.
    const people = await prisma.eventRole.findMany({ where: { eventId: sampleEventId, role: "participant" }, take: 5, skip: 10, select: { userId: true } });
    const posts = [
      { note: "Backend dev, happiest with Go and Postgres. Would love to pair with a designer.", skills: ["Go", "PostgreSQL", "Docker"] },
      { note: "Product designer. I can take an idea to a clickable prototype in an evening.", skills: ["Figma", "UX research", "Prototyping"] },
      { note: "ML engineer, into small models that run offline. Looking for a climate or health idea.", skills: ["Python", "PyTorch", "ONNX"] },
      { note: "First hackathon! Frontend (React), keen to learn from a team that ships.", skills: ["React", "TypeScript", "CSS"] },
    ];
    for (const [i, person] of people.slice(0, 4).entries()) {
      await prisma.eventRole.upsert({ where: { eventId_userId_role: { eventId: jam.id, userId: person.userId, role: "participant" } }, update: {}, create: { eventId: jam.id, userId: person.userId, role: "participant" } });
      await prisma.finderPost.create({ data: { eventId: jam.id, userId: person.userId, kind: "individual", ...posts[i]!, createdAt: ago(10 - i * 2), updatedAt: ago(10 - i * 2) } });
    }
    const captain = people[4];
    if (captain) {
      await prisma.eventRole.upsert({ where: { eventId_userId_role: { eventId: jam.id, userId: captain.userId, role: "participant" } }, update: {}, create: { eventId: jam.id, userId: captain.userId, role: "participant" } });
      const team = await prisma.team.create({ data: { eventId: jam.id, name: "Night Owls", createdById: captain.userId } });
      await prisma.teamMember.create({ data: { teamId: team.id, eventId: jam.id, userId: captain.userId, role: "captain" } });
      await prisma.finderPost.create({ data: { eventId: jam.id, userId: captain.userId, kind: "team", note: "Building a study-group matcher for night-shift students. Need a designer and someone comfortable with Postgres.", skills: ["Figma", "PostgreSQL"], createdAt: ago(3), updatedAt: ago(3) } });
    }
  }
}

/** Filled-in profiles for the demo accounts (only where the person hasn't written their own). */
async function seedDemoProfiles() {
  const profiles = [
    { email: "priya1@example.org", name: "Priya Sharma", headline: "Full-stack developer, climate-tech nerd", location: "Pune, India", bio: "I build small tools that save people time. Lately: Rust, maps and anything that works offline.", skills: ["TypeScript", "Rust", "PostgreSQL", "Figma"], githubUrl: "https://github.com/priya-builds", website: "https://priya.dev" },
    { email: DEMO_JUDGE_EMAIL, headline: "Staff engineer, developer tools", location: "Berlin", bio: "Fifteen years of build systems and CI. I judge for craft: does it work, is it clear, would I use it on Monday?", skills: ["Go", "Kubernetes", "Developer experience"], githubUrl: "https://github.com/judge-demo" },
    { email: ORGANIZER_EMAIL, name: "Morgan Lee", headline: "Community lead, Dogfood Hack Club", location: "Remote", bio: "I run hackathons for students and early-career developers. Four a year, all judged in the open.", skills: ["Community", "Events", "Python"] },
  ];
  for (const { email, ...p } of profiles) {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true, bio: true } });
    if (u && !u.bio) await prisma.user.update({ where: { id: u.id }, data: p });
  }
  // The README tour links to /u/priya.
  if (!(await prisma.user.findUnique({ where: { handle: "priya" } })))
    await prisma.user.updateMany({ where: { email: "priya1@example.org", handle: null }, data: { handle: "priya" } });
}

/** Everyone gets a handle up front, so /u/<handle> links work before anyone opens their profile. */
async function backfillHandles() {
  const users = await prisma.user.findMany({ where: { handle: null }, select: { id: true, name: true, handle: true }, orderBy: { createdAt: "asc" } });
  for (const u of users) await ensureHandle(u);
  if (users.length) console.log(`assigned handles to ${users.length} people`);
}

/** A few notifications so the demo accounts' bells aren't empty on a fresh install. Keys make it idempotent. */
async function seedDemoNotifications(sampleEventId: string) {
  const [org, judge, priya, sprint, sample] = await Promise.all([
    prisma.user.findUnique({ where: { email: ORGANIZER_EMAIL } }),
    prisma.user.findUnique({ where: { email: DEMO_JUDGE_EMAIL } }),
    prisma.user.findUnique({ where: { email: "priya1@example.org" } }),
    prisma.event.findUnique({ where: { slug: JUDGING_DEMO_SLUG } }),
    prisma.event.findUnique({ where: { id: sampleEventId } }),
  ]);
  if (!org || !judge || !priya || !sprint || !sample) return;
  const cert = await prisma.signedRecord.findFirst({ where: { eventId: sample.id, userId: priya.id, supersededById: null } });
  const [assigned, submitted] = await Promise.all([
    prisma.assignment.count({ where: { eventId: sprint.id, judgeId: judge.id, status: { not: "recused" } } }),
    prisma.assignment.count({ where: { eventId: sprint.id, judgeId: judge.id, status: "submitted" } }),
  ]);
  const left = assigned - submitted;
  const notes: Note[] = [
    { userId: judge.id, eventId: sprint.id, category: "judging", title: `${assigned} projects to review`, body: sprint.name, url: `/events/${sprint.slug}/judging`, key: "demo:judge:assigned" },
    { userId: judge.id, eventId: sprint.id, category: "reminders", title: `Judging for ${sprint.name} closes soon`, body: `${left} review${left === 1 ? "" : "s"} left.`, url: `/events/${sprint.slug}/judging`, key: "demo:judge:reminder" },
    { userId: org.id, eventId: sprint.id, category: "organizer", title: "A webhook keeps failing", body: "CRM sync: 503 Service Unavailable. Retrying with backoff.", url: `/events/${sprint.slug}/manage/webhooks`, key: "demo:org:webhook" },
    { userId: priya.id, eventId: sample.id, category: "results", title: `Results are out for ${sample.name}`, url: `/events/${sample.slug}/results`, key: "demo:priya:results" },
    ...(cert ? [{ userId: priya.id, eventId: sample.id, category: "results" as const, title: `Your certificate for ${sample.name} is ready`, url: `/certificates/${cert.id}`, key: "demo:priya:cert" }] : []),
  ];
  // Demo notifications never email.
  const n = await notify(prisma, notes);
  if (n) await prisma.notification.updateMany({ where: { key: { startsWith: "demo:" } }, data: { emailWanted: false } });
}

/** SEED_DEMO=false: the fixed demo sessions, the demo API token and the demo webhooks stop working. */
async function removeDemoAccess() {
  const { count } = await prisma.session.deleteMany({ where: { seeded: true } });
  const tokens = await prisma.apiToken.deleteMany({ where: { seeded: true } });
  const hooks = await prisma.webhook.deleteMany({ where: { url: { startsWith: DEMO_RECEIVER } } });
  console.log(`SEED_DEMO=false: removed ${count} demo sessions, ${tokens.count} demo API tokens and ${hooks.count} demo webhooks`);
}

async function main() {
  const seedStartedAt = new Date();
  const demoHash = config.seedDemo ? await hashPassword(DEMO_PASSWORD) : null;
  const adminHash = process.env.ADMIN_PASSWORD ? await hashPassword(process.env.ADMIN_PASSWORD) : demoHash;

  await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: process.env.ADMIN_PASSWORD ? { passwordHash: adminHash, isAdmin: true } : {},
    create: { email: ADMIN_EMAIL, name: "Portal Admin", isAdmin: true, passwordHash: adminHash },
  });
  // A real install: no sample event, no demo people. Just the admin, who hosts from there.
  if (process.env.SEED_FIXTURES === "false") {
    if (!config.seedDemo) await removeDemoAccess();
    if (!process.env.ADMIN_PASSWORD && !(await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } }))?.passwordHash)
      console.warn(`${ADMIN_EMAIL} has no password: set ADMIN_PASSWORD, or use "Forgot password" on the login page.`);
    console.log(`SEED_FIXTURES=false: no sample data. Sign in as ${ADMIN_EMAIL}.`);
    return;
  }

  const fixture = JSON.parse(await readFile(config.fixturesPath, "utf8"));
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
    await seedPairwiseDemo(prisma);
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
    await removeDemoAccess();
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
  await seedDemoNotifications(event.id);
  await seedDemoProfiles();
  await seedDemoCommunity(organizer.id, event.id);
  // Seeding replays history (results published, certificates issued) through the audit log, which
  // queues notification emails. Those people never asked for mail from a demo install: keep the
  // in-portal notifications, skip the emails.
  await prisma.notification.updateMany({ where: { createdAt: { gte: seedStartedAt }, emailWanted: true, emailedAt: null }, data: { emailWanted: false } });
  lines.push(`  ${"api token".padEnd(12)} Authorization: Bearer ${DEMO_API_TOKEN}   organizer, read-only`);
  console.log(["", "seeded. test logins:", ...lines, `  password for every seeded account: ${DEMO_PASSWORD}`, ""].join("\n"));
}

main()
  .then(backfillHandles)
  .catch((err) => {
    console.error("seed failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
