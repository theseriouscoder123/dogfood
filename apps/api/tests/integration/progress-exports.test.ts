// T2 phase 4: the organizer's progress view, reminders, redistribution and CSV exports.
import { afterAll, describe, expect, it } from "vitest";
import { api, makeEvent, makeJudge, makeReview, makeTeamWithProject, makeUser, prisma } from "./helpers";
import { verifyAuditChain } from "../../src/audit";

afterAll(async () => {
  await prisma.$disconnect();
});

const HOUR = 3_600_000;

/**
 * Judging is 60% through. Five projects, one rubric criterion, and four judges:
 *   done    submitted both of theirs
 *   behind  1 of 3 submitted (33%, well under a 60% pace)
 *   idle    never opened either of theirs
 *   fresh   nothing assigned
 */
async function setup() {
  const ctx = await makeEvent({ open: false });
  const now = Date.now();
  await prisma.event.update({ where: { id: ctx.event.id }, data: { judgingOpensAt: new Date(now - 60 * HOUR), judgingClosesAt: new Date(now + 40 * HOUR) } });
  const o = ctx.organizer.cookie;
  const c1 = (await api().post(`${ctx.base}/criteria`).set("Cookie", o).send({ label: "Impact", weight: 1 })).body.criterion;
  const p = [];
  for (const title of ["Alpha", "Bravo", "Charlie", "Delta", "Echo"]) p.push(await makeTeamWithProject(ctx.event.id, ctx.trackA.id, title));
  const [done, behind, idle, fresh] = [await makeJudge(ctx.event.id), await makeJudge(ctx.event.id), await makeJudge(ctx.event.id), await makeJudge(ctx.event.id)];
  await makeReview(ctx.event.id, done.id, p[0]!.project.id, { [c1.id]: 4 });
  await makeReview(ctx.event.id, done.id, p[1]!.project.id, { [c1.id]: 5 });
  await makeReview(ctx.event.id, behind.id, p[2]!.project.id, { [c1.id]: 3 });
  await makeReview(ctx.event.id, behind.id, p[3]!.project.id);
  await makeReview(ctx.event.id, behind.id, p[0]!.project.id);
  const idleA = (await makeReview(ctx.event.id, idle.id, p[1]!.project.id)).assignment;
  const idleB = (await makeReview(ctx.event.id, idle.id, p[4]!.project.id)).assignment;
  return { ...ctx, c1, p, done, behind, idle, fresh, idleA, idleB };
}

type JudgeRow = { id: string; pace: string; straggler: boolean; active: number; submitted: number };

describe("progress", () => {
  it("reports totals, each judge's pace, and projects at risk", async () => {
    const s = await setup();
    const res = await api().get(`${s.base}/progress`).set("Cookie", s.organizer.cookie);
    expect(res.status).toBe(200);
    expect(res.body.judgingWindow).toBe("open");
    expect(res.body.window.elapsed).toBeCloseTo(0.6, 1);
    expect(res.body.totals).toMatchObject({ reviews: 7, submitted: 3, notStarted: 4, projects: 5, judges: 4, judgesDone: 1, stragglers: 2 });

    const pace = Object.fromEntries((res.body.judges as JudgeRow[]).map((j) => [j.id, j.pace]));
    expect(pace).toEqual({ [s.done.id]: "done", [s.behind.id]: "behind", [s.idle.id]: "not_started", [s.fresh.id]: "unassigned" });
    // Stragglers are listed first.
    expect((res.body.judges as JudgeRow[]).slice(0, 2).every((j) => j.straggler)).toBe(true);

    const attention = res.body.attention as Array<{ title: string; reasons: string[] }>;
    const echo = attention.find((a) => a.title === "Echo")!;
    expect(echo.reasons).toContain("waiting on a judge who is behind");
    expect(echo.reasons.some((r) => r.includes("of 3 reviewers"))).toBe(true);

    const points = res.body.timeline.points as Array<{ n: number | null }>;
    expect(points.filter((x) => x.n !== null).at(-1)!.n).toBe(3);
    expect(points.at(-1)!.n).toBeNull(); // the future hasn't happened yet
  });

  it("is for organizers only", async () => {
    const s = await setup();
    const participant = await makeUser();
    for (const cookie of [s.done.cookie, participant.cookie]) expect((await api().get(`${s.base}/progress`).set("Cookie", cookie)).status).toBe(403);
    expect((await api().get(`${s.base}/progress`)).status).toBe(401);
    expect((await api().post(`${s.base}/progress/remind`).set("Cookie", s.done.cookie).send({ judgeIds: [s.idle.id] })).status).toBe(403);
    expect((await api().post(`${s.base}/judges/${s.idle.id}/redistribute`).set("Cookie", s.done.cookie).send({})).status).toBe(403);
  });
});

describe("reminders", () => {
  it("emails judges who owe reviews, skips the rest, and won't nag twice in six hours", async () => {
    const s = await setup();
    const stranger = await makeUser();
    const first = await api()
      .post(`${s.base}/progress/remind`)
      .set("Cookie", s.organizer.cookie)
      .send({ judgeIds: [s.idle.id, s.behind.id, s.done.id, stranger.id] });
    expect(first.status).toBe(200);
    expect(first.body.sent.sort()).toEqual([s.idle.id, s.behind.id].sort());
    expect(first.body.skipped).toEqual(
      expect.arrayContaining([
        { judgeId: s.done.id, reason: "no reviews outstanding" },
        { judgeId: stranger.id, reason: "not a judge of this event" },
      ]),
    );
    const again = await api().post(`${s.base}/progress/remind`).set("Cookie", s.organizer.cookie).send({ judgeIds: [s.idle.id] });
    expect(again.body).toEqual({ sent: [], skipped: [{ judgeId: s.idle.id, reason: "already reminded in the last 6 hours" }] });

    const rows = await prisma.auditLog.findMany({ where: { eventId: s.event.id, action: "judge.reminded" } });
    expect(rows.map((r) => r.entityId).sort()).toEqual([s.idle.id, s.behind.id].sort());
    const progress = await api().get(`${s.base}/progress`).set("Cookie", s.organizer.cookie);
    expect((progress.body.judges as Array<{ id: string; lastRemindedAt: string | null }>).find((j) => j.id === s.idle.id)!.lastRemindedAt).not.toBeNull();
  });

  it("refuses once judging has closed", async () => {
    const s = await setup();
    await prisma.event.update({ where: { id: s.event.id }, data: { judgingClosesAt: new Date(Date.now() - HOUR) } });
    const res = await api().post(`${s.base}/progress/remind`).set("Cookie", s.organizer.cookie).send({ judgeIds: [s.idle.id] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("judging_closed");
  });
});

describe("redistribution", () => {
  it("previews without changing anything, then commits exactly what was previewed", async () => {
    const s = await setup();
    const url = `${s.base}/judges/${s.idle.id}/redistribute`;
    const preview = await api().post(url).set("Cookie", s.organizer.cookie).send({});
    expect(preview.status).toBe(200);
    expect(preview.body.released.map((r: { assignmentId: string }) => r.assignmentId).sort()).toEqual([s.idleA.id, s.idleB.id].sort());
    const moves = preview.body.moves as Array<{ projectId: string; judgeId: string }>;
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => m.judgeId !== s.idle.id)).toBe(true);
    // Only the released projects get new judges.
    expect(new Set(moves.map((m) => m.projectId))).toEqual(new Set([s.p[1]!.project.id, s.p[4]!.project.id]));
    expect(await prisma.assignment.count({ where: { judgeId: s.idle.id } })).toBe(2);

    const commit = await api().post(url).set("Cookie", s.organizer.cookie).send({ commit: true, inputHash: preview.body.inputHash, seed: preview.body.seed });
    expect(commit.status).toBe(201);
    expect(commit.body).toMatchObject({ released: 2, created: moves.length });
    expect(await prisma.assignment.count({ where: { judgeId: s.idle.id } })).toBe(0);
    const created = await prisma.assignment.findMany({ where: { batchId: commit.body.batchId }, select: { judgeId: true, projectId: true } });
    expect(created.map((a) => `${a.judgeId}|${a.projectId}`).sort()).toEqual(moves.map((m) => `${m.judgeId}|${m.projectId}`).sort());
    expect((await prisma.assignmentBatch.findUniqueOrThrow({ where: { id: commit.body.batchId } })).algorithm).toBe("redistribute-v1");
    expect(await prisma.auditLog.count({ where: { eventId: s.event.id, action: "assignments.redistributed", entityId: s.idle.id } })).toBe(1);
  });

  it("never moves work a judge has started, and refuses a stale preview", async () => {
    const s = await setup();
    const url = `${s.base}/judges/${s.behind.id}/redistribute`;
    const preview = await api().post(url).set("Cookie", s.organizer.cookie).send({});
    // behind: 1 submitted, 2 untouched. Only the untouched ones are released.
    expect(preview.body.released).toHaveLength(2);

    // The judge starts one of them before the organizer confirms.
    const started = preview.body.released[0].assignmentId as string;
    await prisma.assignment.update({ where: { id: started }, data: { status: "in_progress" } });
    const stale = await api().post(url).set("Cookie", s.organizer.cookie).send({ commit: true, inputHash: preview.body.inputHash, seed: preview.body.seed });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("stale_preview");
    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: started } })).status).toBe("in_progress");
  });

  it("explains when there is nothing to move, and 404s for non-judges", async () => {
    const s = await setup();
    const done = await api().post(`${s.base}/judges/${s.done.id}/redistribute`).set("Cookie", s.organizer.cookie).send({});
    expect(done.status).toBe(409);
    expect(done.body.error.code).toBe("nothing_to_release");
    const stranger = await makeUser();
    expect((await api().post(`${s.base}/judges/${stranger.id}/redistribute`).set("Cookie", s.organizer.cookie).send({})).status).toBe(404);
    expect((await api().post(`${s.base}/judges/not-a-uuid/redistribute`).set("Cookie", s.organizer.cookie).send({})).status).toBe(404);
  });
});

describe("CSV exports", () => {
  const FILES = ["participants.csv", "teams.csv", "projects.csv", "judges.csv", "assignments.csv", "reviews.csv", "results.csv", "comments.csv", "ballots.csv", "audit.csv"];

  it("lists every stage with row counts, and each file downloads as CSV", async () => {
    const s = await setup();
    const index = await api().get(`${s.base}/export`).set("Cookie", s.organizer.cookie);
    expect(index.status).toBe(200);
    expect(index.body.exports.map((x: { file: string }) => x.file)).toEqual(FILES);
    const rows = Object.fromEntries(index.body.exports.map((x: { file: string; rows: number }) => [x.file, x.rows]));
    expect(rows).toMatchObject({ "participants.csv": 5, "teams.csv": 5, "projects.csv": 5, "judges.csv": 4, "assignments.csv": 7, "reviews.csv": 3, "results.csv": 5 });

    // Ballots stay sealed until voting closes (this event has no vote at all).
    expect(index.body.exports.find((x: { file: string }) => x.file === "ballots.csv")).toMatchObject({ rows: null, unavailable: expect.stringMatching(/sealed/) });
    expect((await api().get(`${s.base}/export/ballots.csv`).set("Cookie", s.organizer.cookie)).body.error.code).toBe("sealed");
    const downloadable = FILES.filter((f) => f !== "ballots.csv");

    for (const file of downloadable) {
      const res = await api().get(`${s.base}/export/${file}`).set("Cookie", s.organizer.cookie);
      expect(res.status, file).toBe(200);
      expect(res.headers["content-type"]).toMatch(/^text\/csv/);
      expect(res.headers["content-disposition"]).toContain(`${s.event.slug}-${file}`);
      const lines = res.text.replace(/^﻿/, "").trimEnd().split("\r\n");
      expect(lines[0]!.split(",").length, file).toBeGreaterThan(3);
    }
    const audited = await prisma.auditLog.findMany({ where: { eventId: s.event.id, action: "export.downloaded" } });
    expect(audited.map((a) => (a.after as { file: string }).file)).toEqual(downloadable);
    expect((await verifyAuditChain()).ok).toBe(true);
  });

  it("reviews.csv has one row per criterion and results rank by score", async () => {
    const s = await setup();
    const reviews = (await api().get(`${s.base}/export/reviews.csv`).set("Cookie", s.organizer.cookie)).text.trimEnd().split("\r\n");
    expect(reviews).toHaveLength(4); // header + 3 submitted reviews × 1 criterion
    expect(reviews[0]).toContain("review_id,assignment_id,project_id");
    const results = (await api().get(`${s.base}/export/results.csv`).set("Cookie", s.organizer.cookie)).text.replace(/^﻿/, "").trimEnd().split("\r\n");
    expect(results[1]).toMatch(/^1,.*,Bravo,/); // Bravo got the only 5
    expect(results[1]).toContain("provisional"); // 1 review < 3
  });

  it("neutralizes spreadsheet formulas and includes private answers for organizers", async () => {
    const s = await setup();
    await prisma.project.update({ where: { id: s.p[0]!.project.id }, data: { title: '=HYPERLINK("http://evil.example","click")' } });
    const q = await prisma.submissionQuestion.create({ data: { eventId: s.event.id, label: "Team contact", type: "short_text", isPublic: false } });
    await prisma.projectAnswer.create({ data: { projectId: s.p[0]!.project.id, questionId: q.id, value: "@ops on call" } });
    const csv = (await api().get(`${s.base}/export/projects.csv`).set("Cookie", s.organizer.cookie)).text;
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"",""click"")"`);
    expect(csv).toContain("q: Team contact (private)");
    expect(csv).toContain("'@ops on call");
  });

  it("is for organizers only, and unknown files are 404", async () => {
    const s = await setup();
    for (const cookie of [s.done.cookie, s.p[0]!.member.cookie]) {
      expect((await api().get(`${s.base}/export`).set("Cookie", cookie)).status).toBe(403);
      expect((await api().get(`${s.base}/export/reviews.csv`).set("Cookie", cookie)).status).toBe(403);
    }
    expect((await api().get(`${s.base}/export/participants.csv`)).status).toBe(401);
    expect((await api().get(`${s.base}/export/passwords.csv`).set("Cookie", s.organizer.cookie)).status).toBe(404);
  });
});
