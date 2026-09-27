// T2 phase 1: rubric, judge roster, conflicts of interest.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { api, makeEvent, makeJudge, makeReview, makeTeamWithProject, makeUser, prisma } from "./helpers";
import { verifyAuditChain } from "../../src/audit";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("rubric", () => {
  let ctx: Awaited<ReturnType<typeof makeEvent>>;
  beforeEach(async () => {
    ctx = await makeEvent();
  });

  it("only organizers can change the rubric", async () => {
    const participant = await makeUser();
    const judge = await makeJudge(ctx.event.id);
    const body = { label: "Impact", weight: 2 };
    expect((await api().post(`${ctx.base}/criteria`).send(body)).status).toBe(401);
    expect((await api().post(`${ctx.base}/criteria`).set("Cookie", participant.cookie).send(body)).status).toBe(403);
    expect((await api().post(`${ctx.base}/criteria`).set("Cookie", judge.cookie).send(body)).status).toBe(403);
    expect((await api().post(`${ctx.base}/criteria`).set("Cookie", ctx.organizer.cookie).send(body)).status).toBe(201);
  });

  it("creates stable, unique keys and validates weights and ranges", async () => {
    const o = ctx.organizer.cookie;
    const a = await api().post(`${ctx.base}/criteria`).set("Cookie", o).send({ label: "Technical Depth", weight: 3 });
    const b = await api().post(`${ctx.base}/criteria`).set("Cookie", o).send({ label: "Technical depth!", weight: 1 });
    expect(a.body.criterion.key).toBe("technical_depth");
    expect(b.body.criterion.key).toBe("technical_depth_2");
    expect(a.body.criterion).toMatchObject({ weight: 3, minScore: 1, maxScore: 5, position: 0 });
    expect(b.body.criterion.position).toBe(1);

    expect((await api().post(`${ctx.base}/criteria`).set("Cookie", o).send({ label: "X", weight: 0 })).status).toBe(400);
    expect((await api().post(`${ctx.base}/criteria`).set("Cookie", o).send({ label: "X", weight: 1, minScore: 5, maxScore: 5 })).status).toBe(400);
    expect((await api().patch(`${ctx.base}/criteria/${a.body.criterion.id}`).set("Cookie", o).send({ minScore: 9 })).status).toBe(400);
  });

  it("freezes structure once anyone has scored, but weights and labels stay editable", async () => {
    const o = ctx.organizer.cookie;
    const c1 = (await api().post(`${ctx.base}/criteria`).set("Cookie", o).send({ label: "Functionality", weight: 1 })).body.criterion;
    const c2 = (await api().post(`${ctx.base}/criteria`).set("Cookie", o).send({ label: "Design", weight: 1 })).body.criterion;
    expect((await api().get(`${ctx.base}/rubric`).set("Cookie", o)).body.locked).toBe(false);

    const { project } = await makeTeamWithProject(ctx.event.id, ctx.trackA.id);
    const judge = await makeJudge(ctx.event.id);
    await makeReview(ctx.event.id, judge.id, project.id, { [c1.id]: 4, [c2.id]: 3 });

    const rubric = await api().get(`${ctx.base}/rubric`).set("Cookie", o);
    expect(rubric.body).toMatchObject({ locked: true, scoreCount: 2 });
    expect((await api().post(`${ctx.base}/criteria`).set("Cookie", o).send({ label: "Late", weight: 1 })).body.error.code).toBe("rubric_locked");
    expect((await api().delete(`${ctx.base}/criteria/${c1.id}`).set("Cookie", o)).status).toBe(409);
    expect((await api().patch(`${ctx.base}/criteria/${c1.id}`).set("Cookie", o).send({ maxScore: 10 })).status).toBe(409);

    const w = await api().patch(`${ctx.base}/criteria/${c1.id}`).set("Cookie", o).send({ weight: 2.5, label: "Does it work?" });
    expect(w.status).toBe(200);
    expect(w.body.criterion).toMatchObject({ weight: 2.5, label: "Does it work?", key: "functionality" });

    const audit = await prisma.auditLog.findFirst({ where: { eventId: ctx.event.id, action: "rubric.weights_changed" } });
    expect(audit?.before).toMatchObject({ weight: 1 });
    expect(audit?.after).toMatchObject({ weight: 2.5 });
  });

  it("the database refuses a score outside the criterion's range, whatever the code does", async () => {
    const c = (await api().post(`${ctx.base}/criteria`).set("Cookie", ctx.organizer.cookie).send({ label: "Q", weight: 1 })).body.criterion;
    const { project } = await makeTeamWithProject(ctx.event.id, ctx.trackA.id);
    const judge = await makeJudge(ctx.event.id);
    await expect(makeReview(ctx.event.id, judge.id, project.id, { [c.id]: 6 })).rejects.toThrow(/outside the allowed range/);
  });

  it("publishes weights and the lock state on the public event page", async () => {
    await api().post(`${ctx.base}/criteria`).set("Cookie", ctx.organizer.cookie).send({ label: "Impact", weight: 2, description: "Who benefits?" });
    const res = await api().get(ctx.base);
    expect(res.body.rubricLocked).toBe(false);
    expect(res.body.criteria[0]).toMatchObject({ label: "Impact", weight: 2, description: "Who benefits?" });
  });
});

describe("judge roster", () => {
  let ctx: Awaited<ReturnType<typeof makeEvent>>;
  beforeEach(async () => {
    ctx = await makeEvent();
  });

  it("invites a new person: password-less account, per-track access, one-time setup link", async () => {
    const res = await api()
      .post(`${ctx.base}/judges`)
      .set("Cookie", ctx.organizer.cookie)
      .send({ email: "New.Judge@Example.org", name: "Nia Judge", trackIds: [ctx.trackA.id] });
    expect(res.status).toBe(201);
    expect(res.body.judge).toMatchObject({ email: "new.judge@example.org", trackIds: [ctx.trackA.id] });

    const user = await prisma.user.findUniqueOrThrow({ where: { email: "new.judge@example.org" } });
    expect(user.passwordHash).toBeNull();
    expect(await prisma.passwordReset.count({ where: { userId: user.id, usedAt: null } })).toBe(1);

    const list = await api().get(`${ctx.base}/judges`).set("Cookie", ctx.organizer.cookie);
    expect(list.body.judges).toHaveLength(1);
    expect(list.body.judges[0]).toMatchObject({ name: "Nia Judge", hasAccount: false, trackIds: [ctx.trackA.id], assigned: 0, submitted: 0 });
  });

  it("refuses conflicts of role: participants, organizers, duplicates", async () => {
    const o = ctx.organizer.cookie;
    const { member } = await makeTeamWithProject(ctx.event.id, ctx.trackA.id);
    expect((await api().post(`${ctx.base}/judges`).set("Cookie", o).send({ email: member.email })).body.error.code).toBe("judge_conflict");
    expect((await api().post(`${ctx.base}/judges`).set("Cookie", o).send({ email: ctx.organizer.email })).body.error.code).toBe("role_conflict");
    await api().post(`${ctx.base}/judges`).set("Cookie", o).send({ email: "once@example.org" });
    expect((await api().post(`${ctx.base}/judges`).set("Cookie", o).send({ email: "once@example.org" })).body.error.code).toBe("already_judge");
  });

  it("a judge of an event can't then join it as a participant", async () => {
    const judge = await makeJudge(ctx.event.id);
    const res = await api().post(`${ctx.base}/register`).set("Cookie", judge.cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("judge_conflict");
  });

  it("rejects tracks from another event", async () => {
    const other = await makeEvent();
    const res = await api().post(`${ctx.base}/judges`).set("Cookie", ctx.organizer.cookie).send({ email: "x@example.org", trackIds: [other.trackA.id] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_track");
  });

  it("won't narrow a judge's tracks out from under their assignments", async () => {
    const judge = await makeJudge(ctx.event.id, [ctx.trackA.id, ctx.trackB.id]);
    const { project } = await makeTeamWithProject(ctx.event.id, ctx.trackB.id);
    await makeReview(ctx.event.id, judge.id, project.id);
    const narrow = await api().patch(`${ctx.base}/judges/${judge.id}`).set("Cookie", ctx.organizer.cookie).send({ trackIds: [ctx.trackA.id] });
    expect(narrow.status).toBe(409);
    expect(narrow.body.error.code).toBe("judge_has_assignments");
    const widen = await api().patch(`${ctx.base}/judges/${judge.id}`).set("Cookie", ctx.organizer.cookie).send({ trackIds: [ctx.trackB.id] });
    expect(widen.status).toBe(200);
    expect((await prisma.judgeTrack.findMany({ where: { userId: judge.id } })).map((t) => t.trackId)).toEqual([ctx.trackB.id]);
  });

  it("keeps judges who have submitted reviews; removes the rest cleanly", async () => {
    const c = (await api().post(`${ctx.base}/criteria`).set("Cookie", ctx.organizer.cookie).send({ label: "Q", weight: 1 })).body.criterion;
    const { project } = await makeTeamWithProject(ctx.event.id, ctx.trackA.id);
    const busy = await makeJudge(ctx.event.id);
    await makeReview(ctx.event.id, busy.id, project.id, { [c.id]: 3 });
    const idle = await makeJudge(ctx.event.id);
    await makeReview(ctx.event.id, idle.id, project.id);

    expect((await api().delete(`${ctx.base}/judges/${busy.id}`).set("Cookie", ctx.organizer.cookie)).body.error.code).toBe("judge_has_reviews");
    expect((await api().delete(`${ctx.base}/judges/${idle.id}`).set("Cookie", ctx.organizer.cookie)).status).toBe(204);
    expect(await prisma.assignment.count({ where: { judgeId: idle.id } })).toBe(0);
    expect(await prisma.eventRole.count({ where: { userId: idle.id, role: "judge" } })).toBe(0);
  });

  it("judges and participants can't see the roster", async () => {
    const judge = await makeJudge(ctx.event.id);
    const participant = await makeUser();
    expect((await api().get(`${ctx.base}/judges`).set("Cookie", judge.cookie)).status).toBe(403);
    expect((await api().get(`${ctx.base}/judges`).set("Cookie", participant.cookie)).status).toBe(403);
    expect((await api().get(`${ctx.base}/judges`)).status).toBe(401);
  });

  it("another event's organizer has no power here", async () => {
    const other = await makeEvent();
    expect((await api().get(`${ctx.base}/judges`).set("Cookie", other.organizer.cookie)).status).toBe(403);
    expect((await api().post(`${ctx.base}/criteria`).set("Cookie", other.organizer.cookie).send({ label: "X", weight: 1 })).status).toBe(403);
  });
});

describe("conflicts of interest", () => {
  it("records a conflict and reports assignments it now affects", async () => {
    const ctx = await makeEvent();
    const judge = await makeJudge(ctx.event.id);
    const { team, project } = await makeTeamWithProject(ctx.event.id, ctx.trackA.id);
    await makeReview(ctx.event.id, judge.id, project.id);

    const res = await api().post(`${ctx.base}/conflicts`).set("Cookie", ctx.organizer.cookie).send({ judgeId: judge.id, teamId: team.id, note: "Former colleague" });
    expect(res.status).toBe(201);
    expect(res.body.affectedAssignments).toBe(1);

    const list = await api().get(`${ctx.base}/conflicts`).set("Cookie", ctx.organizer.cookie);
    expect(list.body.conflicts[0]).toMatchObject({ note: "Former colleague", judge: { id: judge.id }, team: { id: team.id } });

    // Upsert, not duplicate.
    await api().post(`${ctx.base}/conflicts`).set("Cookie", ctx.organizer.cookie).send({ judgeId: judge.id, teamId: team.id, note: "Updated" });
    expect(await prisma.conflictOfInterest.count({ where: { eventId: ctx.event.id } })).toBe(1);

    expect((await api().delete(`${ctx.base}/conflicts/${res.body.conflict.id}`).set("Cookie", ctx.organizer.cookie)).status).toBe(204);
  });

  it("rejects judges and teams from other events", async () => {
    const ctx = await makeEvent();
    const other = await makeEvent();
    const foreignJudge = await makeJudge(other.event.id);
    const { team: foreignTeam } = await makeTeamWithProject(other.event.id, other.trackA.id);
    const judge = await makeJudge(ctx.event.id);
    const { team } = await makeTeamWithProject(ctx.event.id, ctx.trackA.id);
    expect((await api().post(`${ctx.base}/conflicts`).set("Cookie", ctx.organizer.cookie).send({ judgeId: foreignJudge.id, teamId: team.id })).body.error.code).toBe("invalid_judge");
    expect((await api().post(`${ctx.base}/conflicts`).set("Cookie", ctx.organizer.cookie).send({ judgeId: judge.id, teamId: foreignTeam.id })).body.error.code).toBe("invalid_team");
  });
});

describe("audit", () => {
  it("every change above left an intact hash chain", async () => {
    const result = await verifyAuditChain();
    expect(result.ok).toBe(true);
    expect(result.checked).toBeGreaterThan(10);
  });
});
