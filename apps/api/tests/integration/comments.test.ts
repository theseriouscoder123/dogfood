// T3 phase 3: project comments and moderation.
import { afterAll, describe, expect, it } from "vitest";
import { api, makeEvent, makeJudge, makeTeamWithProject, makeUser, prisma } from "./helpers";
import { verifyAuditChain } from "../../src/audit";

afterAll(async () => {
  await prisma.$disconnect();
});

const DAY = 86_400_000;

async function setup() {
  const ctx = await makeEvent({ open: false });
  const { project, member } = await makeTeamWithProject(ctx.event.id, ctx.trackA.id, "Lantern");
  const url = `${ctx.base}/projects/${project.id}/comments`;
  return { ...ctx, project, member, url };
}

/** A user whose account is a few days old (new accounts get extra limits). */
async function established(name?: string) {
  const u = await makeUser({ name });
  await prisma.user.update({ where: { id: u.id }, data: { createdAt: new Date(Date.now() - 5 * DAY) } });
  return u;
}

const post = (url: string, cookie: string, body: string, parentId?: string) => api().post(url).set("Cookie", cookie).send({ body, parentId });

describe("posting and reading", () => {
  it("anyone can read; signed-in people can post and reply one level deep; team and organizer get badges", async () => {
    const s = await setup();
    const fan = await established("Fan");
    const top = await post(s.url, fan.cookie, "Love the offline mode. How does sync handle conflicts?");
    expect(top.status).toBe(201);
    const reply = await post(s.url, s.member.cookie, "Last write wins per field, with a merge log.", top.body.comment.id);
    expect(reply.status).toBe(201);
    expect((await post(s.url, fan.cookie, "Nice, thanks!", reply.body.comment.id)).body.error.code).toBe("reply_depth");
    await post(s.url, s.organizer.cookie, "Reminder: be kind in the comments.");

    const view = await api().get(s.url); // logged out
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ mode: "open", canComment: false, reason: "unauthenticated", count: 3 });
    expect(view.body.threads.map((t: { body: string }) => t.body)).toEqual(["Reminder: be kind in the comments.", "Love the offline mode. How does sync handle conflicts?"]);
    const thread = view.body.threads[1];
    expect(thread.replies[0].author).toEqual({ name: s.member.name, badges: ["team"] });
    expect(view.body.threads[0].author.badges).toEqual(["organizer"]);
    expect((await post(s.url, "", "hello")).status).toBe(401);
  });

  it("stores text exactly as typed: nothing is interpreted as HTML", async () => {
    const s = await setup();
    const u = await established();
    const evil = `<img src=x onerror="alert(1)"> **bold** <script>steal()</script>`;
    await post(s.url, u.cookie, evil);
    const view = await api().get(s.url);
    expect(view.headers["content-type"]).toMatch(/application\/json/);
    expect(view.body.threads[0].body).toBe(evil);
  });

  it("drafts and duplicate projects don't take comments", async () => {
    const s = await setup();
    const u = await established();
    await prisma.project.update({ where: { id: s.project.id }, data: { status: "draft" } });
    expect((await api().get(s.url).set("Cookie", u.cookie)).status).toBe(404);
    expect((await api().get(s.url).set("Cookie", s.member.cookie)).body.error.code).toBe("not_public");
  });

  it("judges wait until judging closes", async () => {
    const s = await setup();
    const judge = await makeJudge(s.event.id);
    expect((await post(s.url, judge.cookie, "Interesting approach")).body.error.code).toBe("judge_cannot_comment");
    await prisma.event.update({ where: { id: s.event.id }, data: { judgingOpensAt: new Date(Date.now() - 2 * DAY), judgingClosesAt: new Date(Date.now() - DAY) } });
    expect((await post(s.url, judge.cookie, "Interesting approach")).status).toBe(201);
  });
});

describe("authors", () => {
  it("can edit for 15 minutes (keeping the old text in the audit log) and delete any time", async () => {
    const s = await setup();
    const u = await established();
    const other = await established();
    const c = (await post(s.url, u.cookie, "Frist!")).body.comment;
    expect((await api().patch(`${s.url}/${c.id}`).set("Cookie", other.cookie).send({ body: "hacked" })).body.error.code).toBe("not_yours");
    const edited = await api().patch(`${s.url}/${c.id}`).set("Cookie", u.cookie).send({ body: "First! Great demo." });
    expect(edited.body.comment.editedAt).toBeTruthy();
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "comment.edited", entityId: c.id } });
    expect(audit.before).toEqual({ body: "Frist!" });

    await prisma.comment.update({ where: { id: c.id }, data: { createdAt: new Date(Date.now() - 20 * 60_000) } });
    expect((await api().patch(`${s.url}/${c.id}`).set("Cookie", u.cookie).send({ body: "later" })).body.error.code).toBe("edit_window_closed");

    expect((await api().delete(`${s.url}/${c.id}`).set("Cookie", u.cookie)).status).toBe(204);
    expect((await api().get(s.url)).body.threads).toEqual([]); // no replies, so no placeholder
    expect((await prisma.comment.findUniqueOrThrow({ where: { id: c.id } })).body).toBe("First! Great demo."); // kept for moderation
  });

  it("a removed comment with replies stays as a placeholder without its text or author", async () => {
    const s = await setup();
    const [a, b] = [await established(), await established()];
    const top = (await post(s.url, a.cookie, "Is the dataset public?")).body.comment;
    await post(s.url, b.cookie, "Yes, it's in the repo.", top.id);
    await api().delete(`${s.url}/${top.id}`).set("Cookie", a.cookie);
    const t = (await api().get(s.url)).body.threads[0];
    expect(t).toMatchObject({ state: "deleted", body: null, author: null });
    expect(t.replies).toHaveLength(1);
  });
});

describe("spam guards", () => {
  it("brand-new accounts can't post links", async () => {
    const s = await setup();
    const fresh = await makeUser();
    expect((await post(s.url, fresh.cookie, "Vote for us at win-now.xyz")).body.error.code).toBe("links_need_older_account");
    expect((await post(s.url, fresh.cookie, "Nice project")).status).toBe(201);
    const old = await established();
    expect((await post(s.url, old.cookie, "Docs at https://example.org/docs")).status).toBe(201);
  });

  it("refuses the same comment twice and more than five in ten minutes", async () => {
    const s = await setup();
    const u = await established();
    expect((await post(s.url, u.cookie, "Great project!")).status).toBe(201);
    expect((await post(s.url, u.cookie, "great   PROJECT")).body.error.code).toBe("duplicate_comment");
    for (let i = 0; i < 4; i++) expect((await post(s.url, u.cookie, `Point number ${"abcd"[i]}`)).status).toBe(201);
    expect((await post(s.url, u.cookie, "One more thought")).body.error.code).toBe("slow_down");
  });
});

describe("reports and moderation", () => {
  it("three reports from established accounts hide a comment pending review; throwaway accounts can't", async () => {
    const s = await setup();
    const spammer = await established("Spammer");
    const c = (await post(s.url, spammer.cookie, "Vote for Portly!!! Best project ever!!!")).body.comment;
    const report = (cookie: string) => api().post(`${s.url}/${c.id}/report`).set("Cookie", cookie).send({ reason: "spam" });

    expect((await report(spammer.cookie)).body.error.code).toBe("own_comment");
    for (let i = 0; i < 3; i++) expect((await report((await makeUser()).cookie)).body.hidden).toBe(false); // brand-new reporters
    const first = await established();
    expect((await report(first.cookie)).body.hidden).toBe(false);
    expect((await report(first.cookie)).body.error.code).toBe("already_reported");
    await report((await established()).cookie);
    expect((await report((await established()).cookie)).body.hidden).toBe(true);

    expect((await api().get(s.url)).body.threads).toEqual([]);
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: "comment.auto_hidden", entityId: c.id } })).actorLabel).toBe("system:auto-moderation");
  });

  it("organizers see reported comments, hide with a reason, restore, and dismiss wrong reports", async () => {
    const s = await setup();
    const [a, r1] = [await established("Alex"), await established()];
    const c = (await post(s.url, a.cookie, "This is a copy of last year's winner.")).body.comment;
    await api().post(`${s.url}/${c.id}/report`).set("Cookie", r1.cookie).send({ reason: "abuse", note: "accusation without proof" });

    const queue = await api().get(`${s.base}/comments/moderation?filter=reported`).set("Cookie", s.organizer.cookie);
    expect(queue.body.counts).toMatchObject({ reported: 1, hidden: 0 });
    expect(queue.body.items[0]).toMatchObject({ id: c.id, body: "This is a copy of last year's winner.", openReports: [{ reason: "abuse", note: "accusation without proof" }] });

    const o = s.organizer.cookie;
    expect((await api().post(`${s.base}/comments/${c.id}/hide`).set("Cookie", o).send({ reason: "" })).status).toBe(400);
    expect((await api().post(`${s.base}/comments/${c.id}/hide`).set("Cookie", o).send({ reason: "Unverified accusation" })).status).toBe(200);
    expect((await api().get(s.url)).body.threads).toEqual([]);
    expect((await api().get(`${s.base}/comments/moderation?filter=reported`).set("Cookie", o)).body.counts.reported).toBe(0);

    await api().post(`${s.base}/comments/${c.id}/unhide`).set("Cookie", o).send({});
    expect((await api().get(s.url)).body.threads).toHaveLength(1);

    const actions = (await prisma.auditLog.findMany({ where: { eventId: s.event.id, action: { startsWith: "comment." } }, orderBy: { id: "asc" } })).map((x) => x.action);
    expect(actions).toEqual(["comment.created", "comment.reported", "comment.hidden", "comment.unhidden"]);
    expect((await verifyAuditChain()).ok).toBe(true);
  });

  it("dismissing reports undoes an automatic hide", async () => {
    const s = await setup();
    const a = await established();
    const c = (await post(s.url, a.cookie, "Honest criticism: the demo crashed for me.")).body.comment;
    for (let i = 0; i < 3; i++) await api().post(`${s.url}/${c.id}/report`).set("Cookie", (await established()).cookie).send({ reason: "other" });
    expect((await prisma.comment.findUniqueOrThrow({ where: { id: c.id } })).hiddenAt).not.toBeNull();
    const res = await api().post(`${s.base}/comments/${c.id}/dismiss`).set("Cookie", s.organizer.cookie).send({ note: "Fair criticism" });
    expect(res.body).toEqual({ dismissed: true, restored: true });
    expect((await api().get(s.url)).body.threads).toHaveLength(1);
  });

  it("the event can switch comments to read-only or off, and moderation is organizers-only", async () => {
    const s = await setup();
    const u = await established();
    await post(s.url, u.cookie, "Before the switch");
    const set = (mode: string) => api().put(`${s.base}/comments/settings`).set("Cookie", s.organizer.cookie).send({ mode });
    await set("read_only");
    expect((await post(s.url, u.cookie, "After")).body.error.code).toBe("comments_read_only");
    expect((await api().get(s.url)).body).toMatchObject({ mode: "read_only", count: 1 });
    await set("off");
    expect((await api().get(s.url)).body).toMatchObject({ mode: "off", threads: [] });

    for (const cookie of [u.cookie, s.member.cookie]) {
      expect((await api().get(`${s.base}/comments/moderation`).set("Cookie", cookie)).status).toBe(403);
      expect((await api().put(`${s.base}/comments/settings`).set("Cookie", cookie).send({ mode: "open" })).status).toBe(403);
    }
  });
});
