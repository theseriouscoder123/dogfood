// T2 phase 6: integrity checks, organizer decisions on flags, and the normalization report.
import { afterAll, describe, expect, it } from "vitest";
import { api, makeEvent, makeJudge, makeReview, makeTeamWithProject, makeUser, prisma } from "./helpers";
import { verifyAuditChain } from "../../src/audit";

afterAll(async () => {
  await prisma.$disconnect();
});

/**
 * Six projects, four judges, three reviews per project, plus three planted problems:
 * "Halo" gives identical criteria everywhere, "Rush" submits 20 seconds after opening,
 * and one review says the project didn't run while giving it top marks.
 */
async function setup() {
  const ctx = await makeEvent({ open: false });
  const o = ctx.organizer.cookie;
  const c1 = (await api().post(`${ctx.base}/criteria`).set("Cookie", o).send({ label: "Build", weight: 1 })).body.criterion;
  const c2 = (await api().post(`${ctx.base}/criteria`).set("Cookie", o).send({ label: "Idea", weight: 1 })).body.criterion;
  const judges = { halo: await makeJudge(ctx.event.id), rush: await makeJudge(ctx.event.id), a: await makeJudge(ctx.event.id), b: await makeJudge(ctx.event.id) };
  const order = [judges.halo, judges.rush, judges.a, judges.b];
  const projects = [];
  for (let i = 0; i < 6; i++) projects.push((await makeTeamWithProject(ctx.event.id, ctx.trackA.id, `P${i}`)).project);
  const quality = [2, 3, 4, 3, 2, 4];
  let mismatch = "";
  for (const [i, p] of projects.entries()) {
    for (let k = 0; k < 3; k++) {
      const judge = order[(i + k) % 4]!;
      const q = quality[i]!;
      const values = judge === judges.halo ? [q, q] : [q, Math.min(5, q + ((i + k) % 2))];
      const { assignment, review } = await makeReview(ctx.event.id, judge.id, p.id, { [c1.id]: values[0]!, [c2.id]: values[1]! });
      const submittedAt = new Date(Date.now() - 3_600_000);
      await prisma.assignment.update({ where: { id: assignment.id }, data: { openedAt: new Date(submittedAt.getTime() - (judge === judges.rush ? 20_000 : 600_000)) } });
      await prisma.review.update({ where: { id: review!.id }, data: { submittedAt, comment: `Review of P${i} by judge ${(i + k) % 4}: fine.` } });
      if (i === 2 && judge === judges.a) {
        await prisma.reviewScore.updateMany({ where: { reviewId: review!.id }, data: { value: 5 } });
        await prisma.review.update({ where: { id: review!.id }, data: { comment: "Didn't run for me and the docs are thin." } });
        mismatch = review!.id;
      }
    }
  }
  return { ...ctx, o, judges, projects, mismatch };
}

type FlagRow = { key: string; type: string; judgeId: string; reviewId: string | null; resolution: { status: string; note: string } | null };

describe("integrity checks", () => {
  it("find the planted problems and report reliability", async () => {
    const s = await setup();
    const res = await api().get(`${s.base}/integrity`).set("Cookie", s.o);
    expect(res.status).toBe(200);
    const flags = res.body.flags as FlagRow[];
    const has = (type: string, judgeId: string) => flags.some((f) => f.type === type && f.judgeId === judgeId);
    expect(has("identical_criteria", s.judges.halo.id)).toBe(true);
    expect(has("fast_reviewer", s.judges.rush.id)).toBe(true);
    expect(flags.filter((f) => f.type === "rushed").every((f) => f.judgeId === s.judges.rush.id)).toBe(true);
    expect(flags.some((f) => f.type === "comment_mismatch" && f.reviewId === s.mismatch)).toBe(true);
    expect(res.body.summary).toMatchObject({ reviewsChecked: 18, timedReviews: 18, open: flags.length });
    expect(res.body.reliability).toHaveProperty("average");
  });

  it("are for organizers only", async () => {
    const s = await setup();
    const participant = await makeUser();
    for (const cookie of [s.judges.a.cookie, participant.cookie]) {
      expect((await api().get(`${s.base}/integrity`).set("Cookie", cookie)).status).toBe(403);
      expect((await api().post(`${s.base}/integrity/resolve`).set("Cookie", cookie).send({ flagKey: "x", status: "dismissed", note: "fine" })).status).toBe(403);
      expect((await api().get(`${s.base}/normalization/report.md`).set("Cookie", cookie)).status).toBe(403);
    }
    // Judges never see flags about themselves through their own console either.
    const queue = await api().get(`${s.base}/judging`).set("Cookie", s.judges.halo.cookie);
    expect(JSON.stringify(queue.body)).not.toMatch(/identical_criteria|integrity/);
  });
});

describe("organizer decisions", () => {
  it("dismissing needs a reason; decisions stick, can be reopened, and are audited", async () => {
    const s = await setup();
    const flag = ((await api().get(`${s.base}/integrity`).set("Cookie", s.o)).body.flags as FlagRow[]).find((f) => f.type === "comment_mismatch")!;
    const resolve = (body: object) => api().post(`${s.base}/integrity/resolve`).set("Cookie", s.o).send({ flagKey: flag.key, ...body });

    expect((await resolve({ status: "dismissed", note: "" })).body.error.code).toBe("note_required");
    expect((await resolve({ status: "dismissed", note: "Judge confirmed the scores; comment was about an older build" })).status).toBe(200);

    const after = await api().get(`${s.base}/integrity`).set("Cookie", s.o);
    const same = (after.body.flags as FlagRow[]).find((f) => f.key === flag.key)!;
    expect(same.resolution).toMatchObject({ status: "dismissed", note: "Judge confirmed the scores; comment was about an older build" });
    expect(after.body.summary.open).toBe(after.body.summary.flags - 1);

    expect((await resolve({ status: "open" })).body.resolution).toBeNull();
    expect((await resolve({ status: "open" })).status).toBe(404);
    const actions = (await prisma.auditLog.findMany({ where: { eventId: s.event.id, action: { startsWith: "integrity." } }, orderBy: { id: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["integrity.flag_resolved", "integrity.flag_reopened"]);
    expect((await verifyAuditChain()).ok).toBe(true);
  });

  it("refuses to resolve a flag that doesn't exist", async () => {
    const s = await setup();
    const res = await api().post(`${s.base}/integrity/resolve`).set("Cookie", s.o).send({ flagKey: "outlier:not-a-review", status: "confirmed" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("flag_not_found");
  });
});

describe("normalization report", () => {
  it("downloads as Markdown with the simulation and the integrity findings, and is audited", async () => {
    const s = await setup();
    const res = await api().get(`${s.base}/normalization/report.md`).set("Cookie", s.o);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/markdown/);
    for (const section of ["# Normalization proof: Test Event", "### Raw vs adjusted ranking", "## Does it work?", "Per-judge z-score", "## Integrity checks"]) expect(res.text).toContain(section);
    const audited = await prisma.auditLog.findFirst({ where: { eventId: s.event.id, action: "export.downloaded" } });
    expect((audited!.after as { file: string }).file).toBe("normalization-report.md");
  }, 60_000);
});
