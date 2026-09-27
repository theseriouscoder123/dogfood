// T2 phase 2: the assignment engine through the real API and database.
import { afterAll, describe, expect, it } from "vitest";
import { api, makeEvent, makeJudge, makeReview, makeTeamWithProject, makeUser, prisma } from "./helpers";
import { verifyAuditChain } from "../../src/audit";

afterAll(async () => {
  await prisma.$disconnect();
});

/** A closed event: 6 projects in track A, 4 in track B; 4 judges on A, 3 on B, 1 on both. */
async function setup() {
  const ctx = await makeEvent({ open: false });
  const a = await Promise.all(Array.from({ length: 6 }, () => makeTeamWithProject(ctx.event.id, ctx.trackA.id)));
  const b = await Promise.all(Array.from({ length: 4 }, () => makeTeamWithProject(ctx.event.id, ctx.trackB.id)));
  const judgesA = await Promise.all(Array.from({ length: 4 }, () => makeJudge(ctx.event.id, [ctx.trackA.id])));
  const judgesB = await Promise.all(Array.from({ length: 3 }, () => makeJudge(ctx.event.id, [ctx.trackB.id])));
  const bridge = await makeJudge(ctx.event.id, [ctx.trackA.id, ctx.trackB.id]);
  return { ...ctx, a, b, judgesA, judgesB, bridge, o: ctx.organizer.cookie };
}

const preview = (base: string, cookie: string, body: object = {}) => api().post(`${base}/assignments/preview`).set("Cookie", cookie).send(body);
const commit = (base: string, cookie: string, p: { params: object; inputHash: string }) =>
  api().post(`${base}/assignments/commit`).set("Cookie", cookie).send({ ...p.params, inputHash: p.inputHash });

describe("preview and commit", () => {
  it("preview writes nothing, is deterministic for a seed, and commit saves exactly the preview", async () => {
    const s = await setup();
    const p1 = await preview(s.base, s.o, { seed: 7 });
    const p2 = await preview(s.base, s.o, { seed: 7 });
    expect(p1.status).toBe(200);
    expect(p2.body.assignments).toEqual(p1.body.assignments);
    expect(p1.body.inputHash).toBe(p2.body.inputHash);
    expect(await prisma.assignment.count({ where: { eventId: s.event.id } })).toBe(0);
    expect(p1.body.summary).toMatchObject({ projects: 10, judges: 8, newAssignments: 30, shortfalls: 0, components: 1, coverage: { 3: 10 } });
    expect(p1.body.canCommit).toBe(true);

    const c = await commit(s.base, s.o, p1.body);
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ created: 30, shortfalls: 0, components: 1 });
    const saved = await prisma.assignment.findMany({ where: { eventId: s.event.id }, select: { judgeId: true, projectId: true, batchId: true } });
    expect(saved.map(({ judgeId, projectId }) => ({ judgeId, projectId })).sort((x, y) => (x.judgeId + x.projectId).localeCompare(y.judgeId + y.projectId))).toEqual(
      p1.body.assignments.map(({ judgeId, projectId }: { judgeId: string; projectId: string }) => ({ judgeId, projectId })).sort((x: { judgeId: string; projectId: string }, y: { judgeId: string; projectId: string }) => (x.judgeId + x.projectId).localeCompare(y.judgeId + y.projectId)),
    );
    expect(new Set(saved.map((x) => x.batchId)).size).toBe(1);

    const batch = await prisma.assignmentBatch.findUniqueOrThrow({ where: { id: c.body.batch.id } });
    expect(batch).toMatchObject({ seed: 7, algorithm: "balanced-greedy-v1" });
    expect(await prisma.auditLog.count({ where: { eventId: s.event.id, action: "assignments.batch_committed" } })).toBe(1);
  });

  it("respects tracks and conflicts of interest in what it saves", async () => {
    const s = await setup();
    // Every track-A judge conflicts with the first track-A team; only the bridge judge may take it.
    for (const j of s.judgesA) await prisma.conflictOfInterest.create({ data: { eventId: s.event.id, judgeId: j.id, teamId: s.a[0]!.team.id, source: "declared" } });
    const p = await preview(s.base, s.o, { seed: 3 });
    await commit(s.base, s.o, p.body);
    const rows = await prisma.assignment.findMany({ where: { eventId: s.event.id }, include: { project: true } });
    const judgesB = new Set(s.judgesB.map((j) => j.id));
    const judgesA = new Set(s.judgesA.map((j) => j.id));
    for (const r of rows) {
      if (r.project.trackId === s.trackA.id) expect(judgesB.has(r.judgeId)).toBe(false);
      if (r.project.trackId === s.trackB.id) expect(judgesA.has(r.judgeId)).toBe(false);
    }
    const onConflicted = rows.filter((r) => r.projectId === s.a[0]!.project.id).map((r) => r.judgeId);
    expect(onConflicted).toEqual([s.bridge.id]);
    expect(p.body.shortfalls).toEqual([expect.objectContaining({ projectId: s.a[0]!.project.id, have: 1, need: 3, reason: "not_enough_eligible_judges" })]);
  });

  it("refuses a stale preview, and re-running adds nothing", async () => {
    const s = await setup();
    const p = await preview(s.base, s.o, { seed: 1 });
    await makeJudge(s.event.id, [s.trackA.id]); // the world changes
    const stale = await commit(s.base, s.o, p.body);
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("stale_preview");

    const fresh = await preview(s.base, s.o, { seed: 1 });
    expect((await commit(s.base, s.o, fresh.body)).status).toBe(201);
    const again = await preview(s.base, s.o, { seed: 1 });
    expect(again.body.summary.newAssignments).toBe(0);
    const noop = await commit(s.base, s.o, again.body);
    expect(noop.status).toBe(200);
    expect(noop.body.created).toBe(0);
  });

  it("won't commit while submissions are open, or commit a simulation", async () => {
    const open = await makeEvent({ open: true });
    await makeTeamWithProject(open.event.id, open.trackA.id);
    await makeJudge(open.event.id);
    const p = await preview(open.base, open.organizer.cookie);
    expect(p.status).toBe(200);
    expect(p.body.canCommit).toBe(false);
    expect((await commit(open.base, open.organizer.cookie, p.body)).body.error.code).toBe("submissions_still_open");

    const s = await setup();
    const sim = await preview(s.base, s.o, { mode: "simulate" });
    expect(sim.body.canCommit).toBe(false);
    expect((await commit(s.base, s.o, sim.body)).body.error.code).toBe("cannot_commit_simulation");
  });

  it("after a recusal, filling again finds a replacement, never the judge who recused", async () => {
    const s = await setup();
    const p = await preview(s.base, s.o, { seed: 5 });
    await commit(s.base, s.o, p.body);
    const victim = await prisma.assignment.findFirstOrThrow({ where: { eventId: s.event.id, project: { trackId: s.trackB.id } } });
    await prisma.assignment.update({ where: { id: victim.id }, data: { status: "recused", recusalReason: "Knows the team" } });

    const refill = await preview(s.base, s.o, { seed: 5 });
    expect(refill.body.summary.newAssignments).toBe(1);
    expect(refill.body.assignments[0].projectId).toBe(victim.projectId);
    expect(refill.body.assignments[0].judgeId).not.toBe(victim.judgeId);
  });
});

describe("manual changes", () => {
  it("explains eligibility and enforces it on manual adds", async () => {
    const s = await setup();
    const target = s.a[1]!.project;
    await prisma.conflictOfInterest.create({ data: { eventId: s.event.id, judgeId: s.judgesA[0]!.id, teamId: s.a[1]!.team.id, source: "declared" } });

    const el = await api().get(`${s.base}/assignments/eligible?projectId=${target.id}`).set("Cookie", s.o);
    const reason = (id: string) => el.body.judges.find((j: { id: string }) => j.id === id)?.reason;
    expect(reason(s.judgesA[0]!.id)).toBe("conflict of interest");
    expect(reason(s.judgesB[0]!.id)).toBe("different track");
    expect(reason(s.judgesA[1]!.id)).toBeNull();

    const add = (judgeId: string) => api().post(`${s.base}/assignments`).set("Cookie", s.o).send({ judgeId, projectId: target.id });
    expect((await add(s.judgesB[0]!.id)).body.error.code).toBe("not_eligible");
    expect((await add(s.judgesA[0]!.id)).body.error.code).toBe("not_eligible");
    expect((await add(s.judgesA[1]!.id)).status).toBe(201);
    expect((await add(s.judgesA[1]!.id)).body.error.message).toMatch(/already assigned/);
  });

  it("reassigns untouched work, keeps recusals as history, and never moves a submitted review", async () => {
    const s = await setup();
    const c = (await api().post(`${s.base}/criteria`).set("Cookie", s.o).send({ label: "Q", weight: 1 })).body.criterion;
    const project = s.a[2]!.project;
    const untouched = (await makeReview(s.event.id, s.judgesA[0]!.id, project.id)).assignment;
    const done = (await makeReview(s.event.id, s.judgesA[1]!.id, project.id, { [c.id]: 4 })).assignment;
    const recused = await prisma.assignment.create({ data: { eventId: s.event.id, judgeId: s.judgesA[2]!.id, projectId: project.id, status: "recused" } });

    const move = (id: string, judgeId: string) => api().post(`${s.base}/assignments/${id}/reassign`).set("Cookie", s.o).send({ judgeId });
    expect((await move(done.id, s.judgesA[3]!.id)).body.error.code).toBe("review_submitted");
    expect((await move(untouched.id, s.judgesA[3]!.id)).status).toBe(201);
    expect(await prisma.assignment.findUnique({ where: { id: untouched.id } })).toBeNull();
    expect((await move(recused.id, s.bridge.id)).status).toBe(201);
    expect(await prisma.assignment.findUnique({ where: { id: recused.id } })).not.toBeNull();

    expect((await api().delete(`${s.base}/assignments/${done.id}`).set("Cookie", s.o)).body.error.code).toBe("review_submitted");
    const list = await api().get(`${s.base}/assignments`).set("Cookie", s.o);
    const row = list.body.projects.find((p: { id: string }) => p.id === project.id);
    expect(row).toMatchObject({ active: 3, submitted: 1 });
    expect(row.assignments.map((a: { status: string }) => a.status).sort()).toEqual(["assigned", "assigned", "recused", "submitted"]);
  });

  it("flags existing assignments that now violate a conflict of interest", async () => {
    const s = await setup();
    await makeReview(s.event.id, s.judgesA[0]!.id, s.a[0]!.project.id);
    await prisma.conflictOfInterest.create({ data: { eventId: s.event.id, judgeId: s.judgesA[0]!.id, teamId: s.a[0]!.team.id, source: "declared" } });
    const list = await api().get(`${s.base}/assignments`).set("Cookie", s.o);
    const row = list.body.projects.find((p: { id: string }) => p.id === s.a[0]!.project.id);
    expect(row.assignments[0].conflict).toBe(true);
  });
});

describe("access", () => {
  it("only organizers of this event can see or change assignments", async () => {
    const s = await setup();
    const other = await makeEvent();
    const participant = await makeUser();
    for (const cookie of [s.judgesA[0]!.cookie, participant.cookie, other.organizer.cookie]) {
      expect((await api().get(`${s.base}/assignments`).set("Cookie", cookie)).status).toBe(403);
      expect((await preview(s.base, cookie)).status).toBe(403);
    }
    expect((await api().get(`${s.base}/assignments`)).status).toBe(401);
  });

  it("audit chain is intact after all of the above", async () => {
    expect((await verifyAuditChain()).ok).toBe(true);
  });
});
