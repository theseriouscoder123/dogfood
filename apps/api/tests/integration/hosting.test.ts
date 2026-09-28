// Hosting: anyone signed in can create a hackathon; it's a private draft until published.
import { afterAll, describe, expect, it } from "vitest";
import { api, makeEvent, makeJudge, makeTeamWithProject, makeUser, prisma } from "./helpers";

afterAll(async () => {
  await prisma.$disconnect();
});

const HOUR = 3_600_000;
const iso = (h: number) => new Date(Date.now() + h * HOUR).toISOString();

async function host(cookie: string, name = `Night Hack ${Math.random().toString(36).slice(2, 7)}`) {
  const r = await api().post("/api/events").set("Cookie", cookie).send({ name, submissionsOpenAt: iso(1), submissionsCloseAt: iso(48), judgingOpensAt: iso(48), judgingClosesAt: iso(96) });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.event.slug as string;
}

describe("hosting a hackathon", () => {
  it("is open to any signed-in user, who becomes its organizer", async () => {
    const u = await makeUser();
    const slug = await host(u.cookie);
    const detail = await api().get(`/api/events/${slug}`).set("Cookie", u.cookie);
    expect(detail.body.myRoles).toEqual(["organizer"]);
    expect(detail.body.event.publishedAt).toBeNull();
    expect((await api().post("/api/events").send({ name: "x" })).status).toBe(401);
  });

  it("keeps a draft invisible to everyone but its organizers and admins", async () => {
    const u = await makeUser();
    const slug = await host(u.cookie);
    const stranger = await makeUser();
    const admin = await makeUser({ admin: true });
    for (const path of [`/api/events/${slug}`, `/api/events/${slug}/projects`, `/api/events/${slug}/results`]) {
      expect((await api().get(path)).status, path).toBe(404);
      expect((await api().get(path).set("Cookie", stranger.cookie)).status, path).toBe(404);
    }
    expect((await api().post(`/api/events/${slug}/register`).set("Cookie", stranger.cookie)).status).toBe(404);
    expect((await api().get(`/api/events/${slug}`).set("Cookie", admin.cookie)).status).toBe(200);
    const list = (await api().get("/api/events")).body.events as Array<{ slug: string }>;
    expect(list.some((e) => e.slug === slug)).toBe(false);
  });

  it("publishes, and only goes back to draft while nobody has joined", async () => {
    const u = await makeUser();
    const slug = await host(u.cookie);
    const stranger = await makeUser();
    expect((await api().post(`/api/events/${slug}/publish`).set("Cookie", stranger.cookie)).status).toBe(404);
    expect((await api().post(`/api/events/${slug}/publish`).set("Cookie", u.cookie)).status).toBe(200);
    expect((await api().get(`/api/events/${slug}`)).status).toBe(200);
    expect(((await api().get("/api/events")).body.events as Array<{ slug: string }>).some((e) => e.slug === slug)).toBe(true);

    await prisma.event.update({ where: { slug }, data: { registrationOpensAt: new Date(Date.now() - HOUR) } });
    expect((await api().post(`/api/events/${slug}/register`).set("Cookie", stranger.cookie)).status).toBe(201);
    const back = await api().post(`/api/events/${slug}/unpublish`).set("Cookie", u.cookie);
    expect(back.status).toBe(409);
    expect(back.body.error.code).toBe("event_has_people");
    expect(await prisma.auditLog.count({ where: { action: "event.published", event: { slug } } })).toBe(1);
  });
});

describe("dashboard and discovery", () => {
  it("shows each event with what matters for each of your roles", async () => {
    const ctx = await makeEvent();
    const { member } = await makeTeamWithProject(ctx.event.id, ctx.trackA.id, "Lamplight");
    const judge = await makeJudge(ctx.event.id);
    const mine = (await api().get("/api/me/dashboard").set("Cookie", member.cookie)).body.events.find((e: { slug: string }) => e.slug === ctx.event.slug);
    expect(mine).toMatchObject({ roles: ["participant"], participant: { team: { members: 1, role: "captain" }, project: { title: "Lamplight", status: "submitted" } }, judge: null, organizer: null });
    const org = (await api().get("/api/me/dashboard").set("Cookie", ctx.organizer.cookie)).body.events[0];
    expect(org.organizer).toMatchObject({ participants: 1, submitted: 1, judges: 1 });
    const j = (await api().get("/api/me/dashboard").set("Cookie", judge.cookie)).body.events[0];
    expect(j.judge).toEqual({ assigned: 0, submitted: 0, inProgress: 0 });
    expect((await api().get("/api/me/dashboard")).status).toBe(401);
  });

  it("searches projects across public events only", async () => {
    const ctx = await makeEvent();
    await makeTeamWithProject(ctx.event.id, ctx.trackA.id, "Zephyrine Search Target");
    const hidden = await makeEvent();
    await makeTeamWithProject(hidden.event.id, hidden.trackA.id, "Zephyrine Draft Secret");
    await prisma.event.update({ where: { id: hidden.event.id }, data: { publishedAt: null } });
    const r = await api().get("/api/projects?q=zephyrine");
    expect(r.body.projects.map((p: { title: string }) => p.title)).toEqual(["Zephyrine Search Target"]);
    expect(r.body.projects[0].event.slug).toBe(ctx.event.slug);
  });
});

describe("duplicating an event", () => {
  it("copies the setup into a new draft with the schedule shifted, and no people or projects", async () => {
    const ctx = await makeEvent();
    await prisma.criterion.create({ data: { eventId: ctx.event.id, key: "impact", label: "Impact", weight: 2, position: 0 } });
    await prisma.prize.create({ data: { eventId: ctx.event.id, name: "Best in Track A", trackId: ctx.trackA.id, value: "$300" } });
    await makeTeamWithProject(ctx.event.id, ctx.trackA.id);
    const opens = new Date(Date.now() + 60 * 86_400_000);
    const r = await api().post(`${ctx.base}/duplicate`).set("Cookie", ctx.organizer.cookie).send({ name: "Test Event 2027", submissionsOpenAt: opens.toISOString() });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const copy = await prisma.event.findUniqueOrThrow({ where: { slug: r.body.event.slug }, include: { tracks: true, prizes: { include: { track: true } }, criteria: true, projects: true, roles: true } });
    expect(copy.publishedAt).toBeNull();
    expect(copy.submissionsOpenAt.toISOString()).toBe(opens.toISOString());
    expect(copy.submissionsCloseAt.getTime() - copy.submissionsOpenAt.getTime()).toBe(ctx.event.submissionsCloseAt.getTime() - ctx.event.submissionsOpenAt.getTime());
    expect(copy.tracks.map((t) => t.name).sort()).toEqual(["Track A", "Track B"]);
    expect(copy.prizes[0]).toMatchObject({ name: "Best in Track A", track: { name: "Track A" } });
    expect(copy.criteria.map((c) => [c.key, Number(c.weight)])).toEqual([["impact", 2]]);
    expect(copy.projects).toHaveLength(0);
    expect(copy.roles.map((x) => x.role)).toEqual(["organizer"]);
    const stranger = await makeUser();
    expect((await api().post(`${ctx.base}/duplicate`).set("Cookie", stranger.cookie).send({ name: "Nope" })).status).toBe(403);
  });
});
