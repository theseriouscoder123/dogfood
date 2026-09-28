// T4 phase 4: bulk export and import. The way out and the way back in must be the same shape:
// export → import → export gives the same file, and the judged ranking survives the trip.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { api, makeEvent, makeUser, prisma, type TestUser } from "./helpers";
import { config } from "../../src/config";
import { importFixtures } from "../../src/seed/importFixtures";
import { computeResults, loadResultInputs, normalizeOptions } from "../../src/judging/results";
import { verifyAuditChain } from "../../src/audit";

let fixture: unknown;
let admin: TestUser;
let sampleSlug: string;

beforeAll(async () => {
  fixture = JSON.parse(await readFile(config.fixturesPath, "utf8"));
  admin = await makeUser({ admin: true });
  // The seed's importer; idempotent, so it's fine if another test file got here first.
  const { event } = await importFixtures(prisma, fixture, { demoPasswordHash: null, actorLabel: "test" });
  sampleSlug = event.slug;
  await prisma.eventRole.upsert({ where: { eventId_userId_role: { eventId: event.id, userId: admin.id, role: "organizer" } }, update: {}, create: { eventId: event.id, userId: admin.id, role: "organizer" } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

const exportOf = async (slug: string) => {
  const r = await api().get(`/api/events/${slug}/export/event.json`).set("Cookie", admin.cookie);
  expect(r.status).toBe(200);
  return JSON.parse(r.text) as Record<string, unknown> & { event: Record<string, unknown>; people: Array<{ email: string }>; organizers: string[] };
};

/** What must survive a move: everything except where and when it was exported, and the slug. */
function portable(file: Awaited<ReturnType<typeof exportOf>>) {
  const { exportedAt: _a, source: _s, organizers: _o, ...rest } = file;
  return { ...rest, event: { ...file.event, slug: "_" }, people: file.people.filter((p) => p.email !== admin.email) };
}

const importFile = (body: unknown, query: string) => api().post(`/api/events/import${query}`).set("Cookie", admin.cookie).send(body as object);

async function ranking(slug: string) {
  const event = await prisma.event.findUniqueOrThrow({ where: { slug } });
  const inputs = await loadResultInputs(prisma, event.id);
  const ref = new Map(inputs.projects.map((p) => [p.id, (p as { externalId?: string | null }).externalId ?? p.id]));
  const refs = await prisma.project.findMany({ where: { eventId: event.id }, select: { id: true, externalId: true } });
  for (const p of refs) ref.set(p.id, p.externalId ?? p.id);
  const r = computeResults(inputs, normalizeOptions({ minReviews: 3 }));
  return r.projects.map((p) => ({ project: ref.get(p.projectId), rank: p.rank, score: p.normalizedScore === null ? null : Math.round(p.normalizedScore * 1e6) / 1e6 })).sort((a, b) => String(a.project).localeCompare(String(b.project)));
}

describe("exporting", () => {
  it("writes the whole event as dogfood-event/v1, for organizers only", async () => {
    const f = await exportOf(sampleSlug);
    expect(f.format).toBe("dogfood-event/v1");
    expect(f).toMatchObject({ event: { slug: sampleSlug, name: "Sample Hack 2026" } });
    expect((f.projects as unknown[]).length).toBe(41);
    expect((f.assignments as Array<{ review: unknown }>).filter((a) => a.review).length).toBeGreaterThan(100);
    expect(JSON.stringify(f)).not.toMatch(/passwordHash|scrypt\$/);

    const stranger = await makeUser();
    expect((await api().get(`/api/events/${sampleSlug}/export/event.json`).set("Cookie", stranger.cookie)).status).toBe(403);
    expect(await prisma.auditLog.count({ where: { action: "export.downloaded", after: { path: ["file"], equals: "event.json" } } })).toBeGreaterThan(0);
  });

  it("is deterministic: two exports of the same event are identical", async () => {
    expect(portable(await exportOf(sampleSlug))).toEqual(portable(await exportOf(sampleSlug)));
  });
});

describe("importing", () => {
  it("round-trips: export → import → export gives the same event and the same judged ranking", async () => {
    const before = await exportOf(sampleSlug);
    const r = await importFile(before, "?slug=round-trip-copy");
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ dryRun: false, source: "dogfood-event/v1", event: { slug: "round-trip-copy" }, counts: { projects: 41, newAccounts: 0 } });

    const after = await exportOf("round-trip-copy");
    expect(portable(after)).toEqual(portable(before));
    // (This caught a real bug: two projects tie exactly, and ranks used to split them by uuid.)
    expect(await ranking("round-trip-copy")).toEqual(await ranking(sampleSlug));
  });

  it("builds the same event from fixtures.json as the seed does", async () => {
    const r = await importFile(fixture, "?slug=fixture-via-api");
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.source).toBe("fixtures");
    expect(portable(await exportOf("fixture-via-api"))).toEqual(portable(await exportOf(sampleSlug)));
  });

  it("dry-runs the real import and keeps nothing", async () => {
    const file = await exportOf(sampleSlug);
    const [events, users, audit] = await Promise.all([prisma.event.count(), prisma.user.count(), prisma.auditLog.count()]);
    const r = await importFile(file, "?slug=only-a-preview&dryRun=true");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ dryRun: true, event: { slug: "only-a-preview" }, counts: { projects: 41, teams: (file.teams as unknown[]).length } });
    expect(await Promise.all([prisma.event.count(), prisma.user.count(), prisma.auditLog.count()])).toEqual([events, users, audit]);
    expect(await prisma.event.findUnique({ where: { slug: "only-a-preview" } })).toBeNull();
  });

  it("reports every problem in a broken file at once, and writes nothing", async () => {
    const f = await exportOf(sampleSlug);
    const projects = f.projects as Array<Record<string, unknown>>;
    projects[0]!.team = "no-such-team";
    projects[1]!.ref = projects[2]!.ref;
    (f.teams as Array<{ members: Array<{ person: string }> }>)[0]!.members.push({ person: "ghost@example.org", role: "member" } as never);
    const scored = (f.assignments as Array<{ review: { scores: Record<string, number> } | null }>).find((a) => a.review)!;
    scored.review!.scores[Object.keys(scored.review!.scores)[0]!] = 99;
    const events = await prisma.event.count();
    const r = await importFile(f, "?slug=broken-file");
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("import_invalid");
    const problems = (r.body.error.details as string[]).join("\n");
    expect(problems).toMatch(/unknown team "no-such-team"/);
    expect(problems).toMatch(/appears twice/);
    expect(problems).toMatch(/ghost@example\.org, who isn't in "people"/);
    expect(problems).toMatch(/= 99 is outside 1–5/);
    expect(await prisma.event.count()).toBe(events);
  });

  it("refuses taken and reserved slugs, unknown formats and non-admins", async () => {
    const f = await exportOf(sampleSlug);
    const taken = await importFile(f, "");
    expect(taken.status).toBe(422);
    expect(taken.body.error.details[0]).toMatch(/already exists/);
    expect((await importFile(f, "?slug=import")).body.error.details.join()).toMatch(/reserved/);
    expect((await importFile({ hello: "world" }, "?slug=x")).body.error.code).toBe("unknown_format");
    const ctx = await makeEvent();
    expect((await api().post("/api/events/import?slug=mine").set("Cookie", ctx.organizer.cookie).send(f)).status).toBe(403);
  });

  it("reuses existing accounts by email without touching them", async () => {
    const f = await exportOf(sampleSlug);
    const someone = (f.people as Array<{ email: string }>)[0]!.email;
    const before = await prisma.user.findUniqueOrThrow({ where: { email: someone } });
    const r = await importFile(f, "?slug=reuse-people");
    expect(r.body.counts.newAccounts).toBe(0);
    const after = await prisma.user.findUniqueOrThrow({ where: { email: someone } });
    expect(after).toEqual(before);
    expect(await prisma.teamMember.count({ where: { userId: before.id } })).toBeGreaterThan(0);
  });

  it("leaves the audit chain intact", async () => {
    expect((await verifyAuditChain()).ok).toBe(true);
  });
});
