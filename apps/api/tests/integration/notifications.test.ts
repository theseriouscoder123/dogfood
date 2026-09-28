// In-app notifications, preferences, deadline reminders and the email queue.
import { afterAll, describe, expect, it } from "vitest";
import { api, makeEvent, makeJudge, makeReview, makeTeamWithProject, makeUser, prisma } from "./helpers";
import { appendAudit } from "../../src/audit";
import { runReminders } from "../../src/notifications/notify";

afterAll(async () => {
  await prisma.$disconnect();
});

const inbox = (userId: string) => prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });

describe("notifications from activity", () => {
  it("tell the team when someone joins and when the project is submitted, but never the person who acted", async () => {
    const ctx = await makeEvent();
    const { member, team, project } = await makeTeamWithProject(ctx.event.id, ctx.trackA.id, "Orbit");
    const invite = await api().post(`${ctx.base}/teams/mine/invites`).set("Cookie", member.cookie).send({});
    const joiner = await makeUser({ name: "Nia Joiner" });
    expect((await api().post(`/api/invites/${invite.body.invite.token}/accept`).set("Cookie", joiner.cookie)).status).toBe(201);

    const captain = await inbox(member.id);
    expect(captain.map((n) => n.title)).toContain(`Nia Joiner joined ${team.name}`);
    expect((await inbox(joiner.id)).some((n) => n.title.includes("joined"))).toBe(false);

    await api().post(`${ctx.base}/projects/${project.id}/unsubmit`).set("Cookie", member.cookie);
    await api().post(`${ctx.base}/projects/${project.id}/submit`).set("Cookie", joiner.cookie);
    expect((await inbox(member.id)).some((n) => n.title === "“Orbit” is submitted")).toBe(true);
    expect((await inbox(joiner.id)).some((n) => n.title === "“Orbit” is submitted")).toBe(false); // they did it
  });

  it("tell a comment's author about replies, and the team about new comments", async () => {
    const ctx = await makeEvent();
    const { member, project } = await makeTeamWithProject(ctx.event.id, ctx.trackA.id, "Loom");
    const fan = await makeUser({ name: "Fan One" });
    const other = await makeUser({ name: "Fan Two" });
    const first = await api().post(`${ctx.base}/projects/${project.id}/comments`).set("Cookie", fan.cookie).send({ body: "Love the idea" });
    expect(first.status).toBe(201);
    await api().post(`${ctx.base}/projects/${project.id}/comments`).set("Cookie", other.cookie).send({ body: "Agreed, great demo", parentId: first.body.comment.id });
    expect((await inbox(member.id)).map((n) => n.title)).toEqual(["Fan One commented on “Loom”", "Fan Two commented on “Loom”"]);
    expect((await inbox(fan.id)).map((n) => n.title)).toEqual(["Fan Two replied to your comment"]);
  });

  it("go to judges and participants when results are published, and respect muted categories", async () => {
    const ctx = await makeEvent();
    const { member } = await makeTeamWithProject(ctx.event.id, ctx.trackA.id);
    const judge = await makeJudge(ctx.event.id);
    await prisma.user.update({ where: { id: judge.id }, data: { mutedNotifications: ["results"] } });
    await prisma.$transaction((tx) => appendAudit(tx, { eventId: ctx.event.id, actorLabel: "test", action: "results.published", entityType: "Event", entityId: ctx.event.id }));
    expect((await inbox(member.id)).map((n) => n.title)).toEqual(["Results are out for Test Event"]);
    expect(await inbox(judge.id)).toHaveLength(0);
    // Published twice (unpublish/publish): still one notification each.
    await prisma.$transaction((tx) => appendAudit(tx, { eventId: ctx.event.id, actorLabel: "test", action: "results.published", entityType: "Event", entityId: ctx.event.id }));
    expect(await inbox(member.id)).toHaveLength(1);
  });

  it("queue an email only for categories that email, and only if the person wants email", async () => {
    const ctx = await makeEvent();
    const a = await makeTeamWithProject(ctx.event.id, ctx.trackA.id);
    const b = await makeTeamWithProject(ctx.event.id, ctx.trackB.id);
    await prisma.user.update({ where: { id: b.member.id }, data: { emailNotifications: false } });
    await prisma.$transaction((tx) => appendAudit(tx, { eventId: ctx.event.id, actorLabel: "test", action: "results.published", entityType: "Event", entityId: ctx.event.id }));
    expect((await inbox(a.member.id))[0]!.emailWanted).toBe(true);
    expect((await inbox(b.member.id))[0]!.emailWanted).toBe(false);
  });
});

describe("deadline reminders", () => {
  it("remind teams that haven't submitted, 24 hours and 1 hour out, once each", async () => {
    const ctx = await makeEvent(); // submissions close in 24 h
    const done = await makeTeamWithProject(ctx.event.id, ctx.trackA.id);
    const late = await makeTeamWithProject(ctx.event.id, ctx.trackB.id);
    await prisma.project.update({ where: { id: late.project.id }, data: { status: "draft", submittedAt: null } });

    const close = ctx.event.submissionsCloseAt.getTime();
    await runReminders(new Date(close - 20 * 3_600_000));
    await runReminders(new Date(close - 19 * 3_600_000));
    expect((await inbox(late.member.id)).map((n) => n.title)).toEqual(["Submissions for Test Event close in 24 hours"]);
    expect(await inbox(done.member.id)).toHaveLength(0);
    await runReminders(new Date(close - 30 * 60_000));
    expect((await inbox(late.member.id)).map((n) => n.title)).toEqual(["Submissions for Test Event close in 24 hours", "One hour left to submit to Test Event"]);
  });

  it("remind judges with reviews left when judging closes within a day", async () => {
    const ctx = await makeEvent({ open: false });
    const { project } = await makeTeamWithProject(ctx.event.id, ctx.trackA.id);
    const busy = await makeJudge(ctx.event.id);
    const finished = await makeJudge(ctx.event.id);
    await makeReview(ctx.event.id, busy.id, project.id);
    const closes = new Date(Date.now() + 10 * 3_600_000);
    await prisma.event.update({ where: { id: ctx.event.id }, data: { judgingClosesAt: closes } });
    await runReminders(new Date());
    expect((await inbox(busy.id)).map((n) => n.body)).toEqual(["1 review left."]);
    expect(await inbox(finished.id)).toHaveLength(0);
  });
});

describe("the notification centre", () => {
  it("lists, counts unread, marks read, and saves preferences", async () => {
    const ctx = await makeEvent();
    const { member } = await makeTeamWithProject(ctx.event.id, ctx.trackA.id);
    for (let i = 0; i < 2; i++) await prisma.notification.create({ data: { userId: member.id, category: "team", title: `n${i}`, url: "/" } });
    const list = await api().get("/api/me/notifications").set("Cookie", member.cookie);
    expect(list.body.unread).toBe(2);
    expect(list.body.notifications.map((n: { title: string }) => n.title)).toEqual(["n1", "n0"]);
    await api().post("/api/me/notifications/read").set("Cookie", member.cookie).send({ ids: [list.body.notifications[0].id] });
    expect((await api().get("/api/me/notifications").set("Cookie", member.cookie)).body.unread).toBe(1);
    await api().post("/api/me/notifications/read").set("Cookie", member.cookie).send({ all: true });
    expect((await api().get("/api/me/notifications").set("Cookie", member.cookie)).body.unread).toBe(0);

    const s = await api().put("/api/me/notification-settings").set("Cookie", member.cookie).send({ email: false, muted: ["comments", "comments"] });
    expect(s.body).toMatchObject({ email: false, muted: ["comments"] });
    expect((await api().put("/api/me/notification-settings").set("Cookie", member.cookie).send({ email: true, muted: ["nonsense"] })).status).toBe(400);
    const stranger = await makeUser();
    expect((await api().get("/api/me/notifications").set("Cookie", stranger.cookie)).body.notifications).toHaveLength(0);
  });
});
