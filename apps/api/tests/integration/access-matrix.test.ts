// Every documented route, called by every kind of person who must be refused.
//
// The route list is the OpenAPI catalogue, whose `access` field says who may call each route, and
// a drift test keeps that catalogue identical to what's mounted. So a new route is covered here the
// moment it's documented, and an undocumented route fails the drift test. For each route this sends
// the request as each persona that access level excludes, and expects a refusal:
//   401 for anonymous callers, 403 (or 404, which reveals nothing) for signed-in ones.
// Refused requests must also leave no trace: the audit log (every change writes one row) must not grow.
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { api, makeEvent, makeJudge, makeReview, makeTeamWithProject, makeUser, prisma, type TestUser } from "./helpers";
import { OPERATIONS, type Access, type Operation } from "../../src/openapi/operations";
import { sha256 } from "../../src/lib/crypto";

afterAll(async () => {
  await prisma.$disconnect();
});

type Persona = "anonymous" | "stranger" | "participant" | "otherTeam" | "judge" | "peerJudge" | "organizer" | "otherOrganizer" | "admin" | "readToken";

/** Who must be refused, by access level. (Public routes refuse nobody.) */
const REFUSED: Record<Access, Persona[]> = {
  public: [],
  signed_in: ["anonymous"],
  participant: ["anonymous"],
  voter: ["anonymous"],
  team_member: ["anonymous", "stranger", "otherTeam", "judge", "peerJudge", "otherOrganizer"],
  judge: ["anonymous", "stranger", "participant", "otherTeam", "otherOrganizer"],
  organizer: ["anonymous", "stranger", "participant", "otherTeam", "judge", "peerJudge", "otherOrganizer"],
  admin: ["anonymous", "stranger", "participant", "judge", "organizer", "otherOrganizer"],
};

function refusedFor(op: Operation): Persona[] {
  const out = new Set(REFUSED[op.access]);
  // A judge's assignment and scores belong to that judge alone; organizers can't score for them.
  if (op.path.includes(":assignmentId") || op.path.includes(":judgeRef")) out.add("peerJudge");
  if (op.access === "judge" && op.method !== "get") out.add("organizer");
  // Tokens belong to whoever made them.
  if (op.path.includes(":tokenId")) out.add("stranger");
  // A read-only token can't change anything, and browser-only routes refuse tokens outright.
  if ((op.method !== "get" && op.access !== "public") || op.browserOnly) out.add("readToken");
  return [...out];
}

describe("the access matrix", () => {
  it("refuses every documented route to everyone its access level excludes, without side effects", async () => {
    // ── the world ──
    const ctx = await makeEvent({ open: false }); // submissions closed, judging open
    const other = await makeEvent();
    const mine = await makeTeamWithProject(ctx.event.id, ctx.trackA.id, "Guarded Project");
    const theirs = await makeTeamWithProject(ctx.event.id, ctx.trackB.id, "Other Project");
    const judge = await makeJudge(ctx.event.id);
    const peer = await makeJudge(ctx.event.id);
    const stranger = await makeUser();
    const admin = await makeUser({ admin: true });
    const { assignment } = await makeReview(ctx.event.id, judge.id, mine.project.id);
    await makeReview(ctx.event.id, peer.id, theirs.project.id);

    const e = ctx.event.id;
    const [criterion, prize, question, comment, webhook, announcement, post] = await Promise.all([
      prisma.criterion.create({ data: { eventId: e, key: `k_${randomUUID().slice(0, 6)}`, label: "Craft", weight: 1, minScore: 1, maxScore: 5 } }),
      prisma.prize.create({ data: { eventId: e, name: "Grand" } }),
      prisma.submissionQuestion.create({ data: { eventId: e, label: "Stack?", type: "short_text" } }),
      prisma.comment.create({ data: { eventId: e, projectId: mine.project.id, authorId: theirs.member.id, body: "Nice" } }),
      prisma.webhook.create({ data: { eventId: e, url: "https://example.org/hook", secret: "whsec_dGVzdA==" } }),
      prisma.announcement.create({ data: { eventId: e, authorId: ctx.organizer.id, title: "Hi", body: "Hello" } }),
      prisma.finderPost.create({ data: { eventId: e, userId: stranger.id, kind: "individual" } }),
    ]);
    // A live invite, and community voting open, so those routes reach their access checks.
    const inviteToken = `inv-${randomUUID()}`;
    await prisma.teamInvite.create({ data: { teamId: theirs.team.id, tokenHash: sha256(inviteToken), createdById: theirs.member.id, expiresAt: new Date(Date.now() + 86_400_000) } });
    await prisma.event.update({ where: { id: e }, data: { votingOpensAt: new Date(Date.now() - 3_600_000), votingClosesAt: new Date(Date.now() + 86_400_000) } });
    const tokenRes = await api().post("/api/auth/tokens").set("Cookie", ctx.organizer.cookie).send({ name: "read", scopes: ["read"] });
    expect(tokenRes.status).toBe(201);

    const values: Record<string, string> = {
      slug: ctx.event.slug,
      projectId: mine.project.id,
      commentId: comment.id,
      trackId: ctx.trackA.id,
      prizeId: prize.id,
      questionId: question.id,
      criterionId: criterion.id,
      userId: mine.member.id,
      judgeId: judge.id,
      judgeRef: judge.id,
      assignmentId: assignment.id,
      webhookId: webhook.id,
      announcementId: announcement.id,
      postId: post.id,
      tokenId: tokenRes.body.token.id,
      ref: mine.member.id,
      file: "scores.csv",
      name: "0".repeat(64) + ".png",
      token: inviteToken,
    };
    const fill = (path: string) => path.replace(/:([a-zA-Z]+)/g, (_, k: string) => values[k] ?? randomUUID());

    const who: Record<Persona, Record<string, string>> = {
      anonymous: {},
      stranger: { Cookie: stranger.cookie },
      participant: { Cookie: mine.member.cookie },
      otherTeam: { Cookie: theirs.member.cookie },
      judge: { Cookie: judge.cookie },
      peerJudge: { Cookie: peer.cookie },
      organizer: { Cookie: ctx.organizer.cookie },
      otherOrganizer: { Cookie: other.organizer.cookie },
      admin: { Cookie: admin.cookie },
      readToken: { Authorization: `Bearer ${tokenRes.body.secret as string}` },
    };

    const auditBefore = await prisma.auditLog.count();
    const failures: string[] = [];
    let calls = 0;
    for (const op of OPERATIONS) {
      for (const persona of refusedFor(op)) {
        const url = fill(op.path);
        let req = api()[op.method](url);
        for (const [h, v] of Object.entries(who[persona])) req = req.set(h, v);
        const res = op.method === "get" || op.method === "delete" ? await req : await req.send({});
        calls++;
        const ok = persona === "anonymous" ? res.status === 401 : res.status === 403 || res.status === 404 || (persona === "readToken" && res.status === 401);
        if (!ok) failures.push(`${op.method.toUpperCase()} ${op.path} as ${persona}: ${res.status} ${JSON.stringify(res.body?.error ?? res.body).slice(0, 120)}`);
      }
    }
    const auditAfter = await prisma.auditLog.count();

    expect(failures, failures.join("\n")).toEqual([]);
    expect(calls).toBeGreaterThan(600);
    expect(auditAfter - auditBefore, "a refused request changed something").toBe(0);
  }, 120_000);
});
