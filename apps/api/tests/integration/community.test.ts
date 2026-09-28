// Announcements and the team finder.
import { afterAll, describe, expect, it } from "vitest";
import { api, makeEvent, makeJudge, makeTeamWithProject, makeUser, prisma } from "./helpers";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("announcements", () => {
  it("are posted by organizers, read by anyone, and notify participants and judges", async () => {
    const ctx = await makeEvent();
    const { member } = await makeTeamWithProject(ctx.event.id, ctx.trackA.id);
    const judge = await makeJudge(ctx.event.id);
    const stranger = await makeUser();
    expect((await api().post(`${ctx.base}/announcements`).set("Cookie", member.cookie).send({ title: "x", body: "y" })).status).toBe(403);

    const r = await api().post(`${ctx.base}/announcements`).set("Cookie", ctx.organizer.cookie).send({ title: "Wi-Fi is back", body: "Use **Hack-5G**." });
    expect(r.status).toBe(201);
    await api().post(`${ctx.base}/announcements`).set("Cookie", ctx.organizer.cookie).send({ title: "Pinned: schedule", body: "Demos at 5pm", pinned: true, notify: false });
    const list = await api().get(`${ctx.base}/announcements`);
    expect(list.body.announcements.map((a: { title: string }) => a.title)).toEqual(["Pinned: schedule", "Wi-Fi is back"]);

    const got = async (id: string) => (await prisma.notification.findMany({ where: { userId: id, category: "announcements" } })).map((n) => n.title);
    expect(await got(member.id)).toEqual(["Wi-Fi is back"]);
    expect(await got(judge.id)).toEqual(["Wi-Fi is back"]);
    expect(await got(stranger.id)).toEqual([]);
    expect(await got(ctx.organizer.id)).toEqual([]);

    const id = r.body.announcement.id;
    expect((await api().patch(`${ctx.base}/announcements/${id}`).set("Cookie", ctx.organizer.cookie).send({ pinned: true })).body.announcement.pinned).toBe(true);
    expect((await api().delete(`${ctx.base}/announcements/${id}`).set("Cookie", ctx.organizer.cookie)).status).toBe(204);
    expect(await prisma.auditLog.count({ where: { action: { startsWith: "announcement." }, eventId: ctx.event.id } })).toBe(4);
  });
});

describe("team finder", () => {
  it("lists people looking and teams with room, and drops them once they're matched", async () => {
    const ctx = await makeEvent();
    await prisma.event.update({ where: { id: ctx.event.id }, data: { maxTeamSize: 2 } });
    const { member } = await makeTeamWithProject(ctx.event.id, ctx.trackA.id);
    const seeker = await makeUser({ name: "Sam Seeker" });
    await api().post(`${ctx.base}/register`).set("Cookie", seeker.cookie);
    await api().post(`${ctx.base}/register`).set("Cookie", member.cookie);

    expect((await api().put(`${ctx.base}/team-finder`).set("Cookie", seeker.cookie).send({ kind: "team" })).body.error.code).toBe("no_team");
    expect((await api().put(`${ctx.base}/team-finder`).set("Cookie", seeker.cookie).send({ kind: "individual", note: "Frontend, some Rust", skills: ["React", "Rust", "React"] })).status).toBe(200);
    expect((await api().put(`${ctx.base}/team-finder`).set("Cookie", member.cookie).send({ kind: "individual" })).body.error.code).toBe("already_on_team");
    expect((await api().put(`${ctx.base}/team-finder`).set("Cookie", member.cookie).send({ kind: "team", note: "Need a designer" })).status).toBe(200);

    const list = await api().get(`${ctx.base}/team-finder`).set("Cookie", member.cookie);
    expect(list.body.posts).toHaveLength(2);
    const seekerPost = list.body.posts.find((p: { kind: string }) => p.kind === "individual");
    expect(seekerPost).toMatchObject({ person: { name: "Sam Seeker" }, skills: ["React", "Rust"] });
    expect(JSON.stringify(list.body)).not.toContain(seeker.email);
    expect(list.body.me).toMatchObject({ onTeam: true, canInvite: true });

    // Invite: the seeker gets a single-use join link in their notifications, and can use it.
    expect((await api().post(`${ctx.base}/team-finder/${seekerPost.id}/invite`).set("Cookie", member.cookie)).status).toBe(201);
    const note = await prisma.notification.findFirstOrThrow({ where: { userId: seeker.id, category: "team" } });
    expect(note.url).toMatch(/^\/join\//);
    expect((await api().post(`/api${note.url.replace("/join/", "/invites/")}/accept`).set("Cookie", seeker.cookie)).status).toBe(201);

    // Matched: the seeker is on a team and the team is full, so both posts drop off.
    expect((await api().get(`${ctx.base}/team-finder`)).body.posts).toHaveLength(0);
  });
});
