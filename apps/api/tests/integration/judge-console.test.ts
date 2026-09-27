// T2 phase 3: the judge console, through the real API and database.
import { afterAll, describe, expect, it } from "vitest";
import { api, makeEvent, makeJudge, makeReview, makeTeamWithProject, makeUser, prisma } from "./helpers";
import { verifyAuditChain } from "../../src/audit";

afterAll(async () => {
  await prisma.$disconnect();
});

/** Submissions closed, judging open, a two-criterion rubric, two judges on the same project. */
async function setup() {
  const ctx = await makeEvent({ open: false });
  const o = ctx.organizer.cookie;
  const c1 = (await api().post(`${ctx.base}/criteria`).set("Cookie", o).send({ label: "Functionality", weight: 2 })).body.criterion;
  const c2 = (await api().post(`${ctx.base}/criteria`).set("Cookie", o).send({ label: "Design", weight: 1, minScore: 1, maxScore: 10 })).body.criterion;
  const { project, team } = await makeTeamWithProject(ctx.event.id, ctx.trackA.id, "Lighthouse");
  const other = await makeTeamWithProject(ctx.event.id, ctx.trackA.id, "Foghorn");
  const judge = await makeJudge(ctx.event.id, [ctx.trackA.id]);
  const peer = await makeJudge(ctx.event.id, [ctx.trackA.id]);
  const mine = (await makeReview(ctx.event.id, judge.id, project.id)).assignment;
  const second = (await makeReview(ctx.event.id, judge.id, other.project.id)).assignment;
  const peers = (await makeReview(ctx.event.id, peer.id, project.id)).assignment;
  const j = `${ctx.base}/judging`;
  return { ...ctx, c1, c2, project, team, judge, peer, mine, second, peers, j };
}

describe("isolation", () => {
  it("a judge sees their own queue and nothing else", async () => {
    const s = await setup();
    const q = await api().get(s.j).set("Cookie", s.judge.cookie);
    expect(q.status).toBe(200);
    expect(q.body.assignments.map((a: { id: string }) => a.id).sort()).toEqual([s.mine.id, s.second.id].sort());
    expect(q.body.progress).toMatchObject({ total: 2, submitted: 0, todo: 2 });
    expect(q.body.criteria.map((c: { label: string }) => c.label)).toEqual(["Functionality", "Design"]);
    expect(JSON.stringify(q.body)).not.toContain(s.peers.id);
  });

  it("another judge's assignment is a 404, not a 403: it doesn't exist as far as you know", async () => {
    const s = await setup();
    for (const path of ["", "/review", "/submit", "/recuse"]) {
      const method = path === "" ? "get" : path === "/review" ? "put" : "post";
      const res = await api()[method](`${s.j}/${s.peers.id}${path}`).set("Cookie", s.judge.cookie).send({ reason: "xxx", scores: {} });
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    // Nothing changed on the peer's assignment.
    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: s.peers.id } })).status).toBe("assigned");
  });

  it("participants, organizers and judges of other events are refused", async () => {
    const s = await setup();
    const participant = await makeUser();
    const foreignJudge = await makeJudge((await makeEvent()).event.id);
    for (const cookie of [participant.cookie, s.organizer.cookie, foreignJudge.cookie]) {
      expect((await api().get(s.j).set("Cookie", cookie)).body.error.code).toBe("not_a_judge");
      expect((await api().get(`${s.j}/${s.mine.id}`).set("Cookie", cookie)).status).toBe(403);
    }
    expect((await api().get(s.j)).status).toBe(401);
  });

  it("judges only see public answers to organizer questions", async () => {
    const s = await setup();
    const pub = await prisma.submissionQuestion.create({ data: { eventId: s.event.id, label: "Stage", type: "short_text", isPublic: true } });
    const priv = await prisma.submissionQuestion.create({ data: { eventId: s.event.id, label: "Secret", type: "short_text", isPublic: false } });
    await prisma.projectAnswer.createMany({ data: [{ projectId: s.project.id, questionId: pub.id, value: "MVP" }, { projectId: s.project.id, questionId: priv.id, value: "hidden" }] });
    const d = await api().get(`${s.j}/${s.mine.id}`).set("Cookie", s.judge.cookie);
    expect(d.body.project.answers).toEqual([{ label: "Stage", type: "short_text", value: "MVP" }]);
    expect(JSON.stringify(d.body)).not.toContain("hidden");
  });
});

describe("scoring", () => {
  it("drafts autosave partially, submission needs every criterion, and opening is timestamped", async () => {
    const s = await setup();
    const d = await api().get(`${s.j}/${s.mine.id}`).set("Cookie", s.judge.cookie);
    expect(d.body.review).toBeNull();
    expect(d.body.nav).toMatchObject({ position: 1, total: 2, nextId: s.second.id, nextUnscoredId: s.second.id });
    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: s.mine.id } })).openedAt).not.toBeNull();

    const put = (body: object) => api().put(`${s.j}/${s.mine.id}/review`).set("Cookie", s.judge.cookie).send(body);
    expect((await put({ scores: { [s.c1.id]: 4 }, comment: "Solid core." })).status).toBe(200);
    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: s.mine.id } })).status).toBe("in_progress");

    const early = await api().post(`${s.j}/${s.mine.id}/submit`).set("Cookie", s.judge.cookie);
    expect(early.status).toBe(422);
    expect(early.body.error.details.missing).toEqual(["Design"]);

    expect((await put({ scores: { [s.c2.id]: 11 } })).body.error.code).toBe("score_out_of_range");
    expect((await put({ scores: { [s.c2.id]: 0 } })).body.error.code).toBe("score_out_of_range");
    expect((await put({ scores: { [s.peers.id]: 3 } })).body.error.code).toBe("invalid_criterion");
    expect((await put({ scores: { [s.c2.id]: 8 }, comment: "Solid core. Pretty, too." })).status).toBe(200);

    const sub = await api().post(`${s.j}/${s.mine.id}/submit`).set("Cookie", s.judge.cookie);
    expect(sub.status).toBe(200);
    const review = await prisma.review.findFirstOrThrow({ where: { assignmentId: s.mine.id }, include: { scores: true } });
    expect(review.status).toBe("submitted");
    expect(Object.fromEntries(review.scores.map((x) => [x.criterionId, x.value]))).toEqual({ [s.c1.id]: 4, [s.c2.id]: 8 });
    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: s.mine.id } })).status).toBe("submitted");

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { eventId: s.event.id, action: "review.submit" } });
    expect(audit.after).toMatchObject({ scores: { [s.c1.id]: 4, [s.c2.id]: 8 }, comment: "Solid core. Pretty, too." });
    expect(typeof (audit.after as { secondsSinceOpened: number }).secondsSinceOpened).toBe("number");

    // The checker's endpoint sees the same review.
    const mineScores = await api().get(`${s.base}/judges/me/scores`).set("Cookie", s.judge.cookie);
    expect(mineScores.body.reviews.find((r: { project: { title: string } }) => r.project.title === "Lighthouse").scores).toEqual({ functionality: 4, design: 8 });
  });

  it("a submitted review can be revised until judging closes, stays complete, and every revision is audited", async () => {
    const s = await setup();
    const put = (body: object) => api().put(`${s.j}/${s.mine.id}/review`).set("Cookie", s.judge.cookie).send(body);
    await put({ scores: { [s.c1.id]: 3, [s.c2.id]: 5 } });
    await api().post(`${s.j}/${s.mine.id}/submit`).set("Cookie", s.judge.cookie);
    expect((await api().post(`${s.j}/${s.mine.id}/submit`).set("Cookie", s.judge.cookie)).body.error.code).toBe("already_submitted");

    expect((await put({ scores: { [s.c1.id]: 5 }, comment: "On reflection, it works." })).status).toBe(200);
    const rev = await prisma.auditLog.findFirstOrThrow({ where: { eventId: s.event.id, action: "review.revised" } });
    expect(rev.before).toMatchObject({ scores: { [s.c1.id]: 3 } });
    expect(rev.after).toMatchObject({ scores: { [s.c1.id]: 5, [s.c2.id]: 5 } });
    expect((await prisma.review.findFirstOrThrow({ where: { assignmentId: s.mine.id } })).status).toBe("submitted");
  });

  it("the judging window is enforced in both directions", async () => {
    const s = await setup();
    await prisma.event.update({ where: { id: s.event.id }, data: { judgingOpensAt: new Date(Date.now() + 3_600_000) } });
    expect((await api().put(`${s.j}/${s.mine.id}/review`).set("Cookie", s.judge.cookie).send({ scores: { [s.c1.id]: 3 } })).body.error.code).toBe("judging_not_open");
    // Opening a project before judging opens doesn't start the clock.
    await api().get(`${s.j}/${s.mine.id}`).set("Cookie", s.judge.cookie);
    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: s.mine.id } })).openedAt).toBeNull();

    await prisma.event.update({ where: { id: s.event.id }, data: { judgingOpensAt: new Date(Date.now() - 7_200_000), judgingClosesAt: new Date(Date.now() - 3_600_000) } });
    expect((await api().put(`${s.j}/${s.mine.id}/review`).set("Cookie", s.judge.cookie).send({ scores: { [s.c1.id]: 3 } })).body.error.code).toBe("judging_closed");
    expect((await api().post(`${s.j}/${s.mine.id}/recuse`).set("Cookie", s.judge.cookie).send({ reason: "Too late" })).body.error.code).toBe("judging_closed");
    expect((await api().get(s.j).set("Cookie", s.judge.cookie)).body.judgingWindow).toBe("closed");
  });
});

describe("recusal", () => {
  it("recusing drops the draft, can declare a conflict, and the pair is never re-assigned", async () => {
    const s = await setup();
    await api().put(`${s.j}/${s.mine.id}/review`).set("Cookie", s.judge.cookie).send({ scores: { [s.c1.id]: 2 } });
    const r = await api().post(`${s.j}/${s.mine.id}/recuse`).set("Cookie", s.judge.cookie).send({ reason: "I mentored this team", declareConflict: true });
    expect(r.status).toBe(200);

    const a = await prisma.assignment.findUniqueOrThrow({ where: { id: s.mine.id }, include: { review: true } });
    expect(a).toMatchObject({ status: "recused", recusalReason: "I mentored this team", review: null });
    expect(await prisma.conflictOfInterest.count({ where: { eventId: s.event.id, judgeId: s.judge.id, teamId: s.team.id } })).toBe(1);

    expect((await api().put(`${s.j}/${s.mine.id}/review`).set("Cookie", s.judge.cookie).send({ scores: { [s.c1.id]: 2 } })).body.error.code).toBe("recused");
    expect((await api().post(`${s.j}/${s.mine.id}/recuse`).set("Cookie", s.judge.cookie).send({ reason: "again" })).body.error.code).toBe("recused");

    const el = await api().get(`${s.base}/assignments/eligible?projectId=${s.project.id}`).set("Cookie", s.organizer.cookie);
    expect(el.body.judges.find((x: { id: string }) => x.id === s.judge.id).eligible).toBe(false);
  });

  it("a submitted review can't be recused by the judge", async () => {
    const s = await setup();
    await api().put(`${s.j}/${s.mine.id}/review`).set("Cookie", s.judge.cookie).send({ scores: { [s.c1.id]: 3, [s.c2.id]: 3 } });
    await api().post(`${s.j}/${s.mine.id}/submit`).set("Cookie", s.judge.cookie);
    expect((await api().post(`${s.j}/${s.mine.id}/recuse`).set("Cookie", s.judge.cookie).send({ reason: "Changed my mind" })).body.error.code).toBe("review_submitted");
  });
});

describe("audit", () => {
  it("chain intact", async () => {
    expect((await verifyAuditChain()).ok).toBe(true);
  });
});
