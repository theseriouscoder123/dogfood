// Organizer side of judging setup: the rubric, the judge roster, and conflicts of interest.
// Mounted at /api/events/:slug. Every route is organizer/admin only.
//
// Rubric rule: once any score exists, the rubric's *structure* (which criteria exist,
// their keys and score ranges) is frozen, because changing it would silently change the
// meaning of scores already given. Labels, descriptions and weights stay editable:
// weights are applied when results are computed, never stored in scores.
import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { accessFor, decideOrganize, enforce } from "../policy";
import { appendAudit, fromRequest } from "../audit";
import { eventBySlug } from "../lib/events";
import { HttpError, notFound } from "../lib/http";
import { randomToken, sha256 } from "../lib/crypto";
import { absoluteUrl, sendMail } from "../lib/mail";

export const judgingAdminRouter = Router({ mergeParams: true });

async function staffEvent(req: Request) {
  const event = await eventBySlug((req.params as { slug?: string }).slug);
  enforce(decideOrganize(await accessFor(req.actor, event.id)));
  return event;
}

export async function scoreCount(eventId: string) {
  return prisma.reviewScore.count({ where: { review: { eventId } } });
}

const slugKey = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "criterion";

// ── rubric ──────────────────────────────────────────────────────────────────

const CriterionBody = z
  .object({
    label: z.string().trim().min(1).max(80),
    description: z.string().trim().max(1000).default(""),
    weight: z.number().gt(0).max(100),
    minScore: z.number().int().min(0).max(100).default(1),
    maxScore: z.number().int().min(1).max(100).default(5),
    position: z.number().int().min(0).max(1000).optional(),
  })
  .refine((c) => c.minScore < c.maxScore, { message: "minScore must be below maxScore", path: ["maxScore"] });

judgingAdminRouter.post("/criteria", async (req, res) => {
  const event = await staffEvent(req);
  const body = CriterionBody.parse(req.body);
  if ((await scoreCount(event.id)) > 0) throw rubricLocked();
  const existing = await prisma.criterion.findMany({ where: { eventId: event.id }, select: { key: true } });
  const taken = new Set(existing.map((c) => c.key));
  let key = slugKey(body.label);
  for (let i = 2; taken.has(key); i++) key = `${slugKey(body.label)}_${i}`;

  const criterion = await prisma.$transaction(async (tx) => {
    const c = await tx.criterion.create({ data: { ...body, key, position: body.position ?? existing.length, eventId: event.id } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "rubric.criterion_added", entityType: "Criterion", entityId: c.id, after: c });
    return c;
  });
  res.status(201).json({ criterion: serializeCriterion(criterion) });
});

judgingAdminRouter.patch("/criteria/:criterionId", async (req, res) => {
  const event = await staffEvent(req);
  const current = await prisma.criterion.findFirst({ where: { id: (req.params as { criterionId: string }).criterionId, eventId: event.id } });
  if (!current) throw notFound("Criterion");
  const body = z
    .object({
      label: z.string().trim().min(1).max(80),
      description: z.string().trim().max(1000),
      weight: z.number().gt(0).max(100),
      minScore: z.number().int().min(0).max(100),
      maxScore: z.number().int().min(1).max(100),
      position: z.number().int().min(0).max(1000),
    })
    .partial()
    .parse(req.body);

  const structural = (body.minScore !== undefined && body.minScore !== current.minScore) || (body.maxScore !== undefined && body.maxScore !== current.maxScore);
  if (structural && (await scoreCount(event.id)) > 0) throw rubricLocked();
  const min = body.minScore ?? current.minScore, max = body.maxScore ?? current.maxScore;
  if (min >= max) throw new HttpError(400, "invalid_range", "minScore must be below maxScore.");

  const updated = await prisma.$transaction(async (tx) => {
    const c = await tx.criterion.update({ where: { id: current.id }, data: body });
    const changed = (Object.keys(body) as Array<keyof typeof body>).filter((k) => String(current[k]) !== String(c[k]));
    if (changed.length) {
      await appendAudit(tx, {
        ...fromRequest(req), eventId: event.id,
        action: changed.includes("weight") ? "rubric.weights_changed" : "rubric.criterion_updated",
        entityType: "Criterion", entityId: c.id,
        before: Object.fromEntries(changed.map((k) => [k, k === "weight" ? Number(current[k]) : current[k]])),
        after: Object.fromEntries(changed.map((k) => [k, k === "weight" ? Number(c[k]) : c[k]])),
      });
    }
    return c;
  });
  res.json({ criterion: serializeCriterion(updated) });
});

judgingAdminRouter.delete("/criteria/:criterionId", async (req, res) => {
  const event = await staffEvent(req);
  const current = await prisma.criterion.findFirst({ where: { id: (req.params as { criterionId: string }).criterionId, eventId: event.id } });
  if (!current) throw notFound("Criterion");
  if ((await scoreCount(event.id)) > 0) throw rubricLocked();
  await prisma.$transaction(async (tx) => {
    await tx.criterion.delete({ where: { id: current.id } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "rubric.criterion_removed", entityType: "Criterion", entityId: current.id, before: serializeCriterion(current) });
  });
  res.status(204).end();
});

const rubricLocked = () =>
  new HttpError(409, "rubric_locked", "Judges have already scored with this rubric, so criteria and score ranges can't change. Labels, descriptions and weights still can.");

function serializeCriterion(c: { id: string; key: string; label: string; description: string; weight: unknown; minScore: number; maxScore: number; position: number }) {
  return { id: c.id, key: c.key, label: c.label, description: c.description, weight: Number(c.weight), minScore: c.minScore, maxScore: c.maxScore, position: c.position };
}

judgingAdminRouter.get("/rubric", async (req, res) => {
  const event = await staffEvent(req);
  const [criteria, scores] = await Promise.all([
    prisma.criterion.findMany({ where: { eventId: event.id }, orderBy: [{ position: "asc" }, { label: "asc" }] }),
    scoreCount(event.id),
  ]);
  res.json({ criteria: criteria.map(serializeCriterion), locked: scores > 0, scoreCount: scores });
});

// ── judges ──────────────────────────────────────────────────────────────────

/** Track ids must belong to this event. An empty list means "all tracks". */
async function validTracks(eventId: string, trackIds: string[]) {
  const unique = [...new Set(trackIds)];
  const found = await prisma.track.count({ where: { eventId, id: { in: unique } } });
  if (found !== unique.length) throw new HttpError(400, "invalid_track", "One or more tracks don't belong to this event.");
  return unique;
}

judgingAdminRouter.get("/judges", async (req, res) => {
  const event = await staffEvent(req);
  const [roles, tracks, counts, conflicts] = await Promise.all([
    prisma.eventRole.findMany({
      where: { eventId: event.id, role: "judge" },
      orderBy: [{ createdAt: "asc" }],
      select: { externalId: true, createdAt: true, user: { select: { id: true, name: true, email: true, passwordHash: true } } },
    }),
    prisma.judgeTrack.findMany({ where: { eventId: event.id }, select: { userId: true, trackId: true } }),
    prisma.assignment.groupBy({ by: ["judgeId", "status"], where: { eventId: event.id }, _count: { _all: true } }),
    prisma.conflictOfInterest.groupBy({ by: ["judgeId"], where: { eventId: event.id }, _count: { _all: true } }),
  ]);
  const tracksOf = new Map<string, string[]>();
  for (const t of tracks) tracksOf.set(t.userId, [...(tracksOf.get(t.userId) ?? []), t.trackId]);
  const countOf = (judgeId: string, statuses: string[]) =>
    counts.filter((c) => c.judgeId === judgeId && statuses.includes(c.status)).reduce((n, c) => n + c._count._all, 0);

  res.json({
    judges: roles.map((r) => ({
      id: r.user.id,
      name: r.user.name,
      email: r.user.email,
      externalId: r.externalId,
      invitedAt: r.createdAt,
      hasAccount: r.user.passwordHash !== null,
      trackIds: tracksOf.get(r.user.id) ?? [],
      assigned: countOf(r.user.id, ["assigned", "in_progress", "submitted"]),
      submitted: countOf(r.user.id, ["submitted"]),
      recused: countOf(r.user.id, ["recused"]),
      conflicts: conflicts.find((c) => c.judgeId === r.user.id)?._count._all ?? 0,
    })),
  });
});

const InviteBody = z.object({
  email: z.email().transform((e) => e.trim().toLowerCase()),
  name: z.string().trim().min(1).max(100).optional(),
  trackIds: z.array(z.uuid()).max(100).default([]),
  sendEmail: z.boolean().default(true),
});

/**
 * Add a judge. Unknown emails get a password-less account plus a one-time "set up your
 * account" link (valid 7 days); existing users get a link to their judging dashboard.
 * Someone who participates in or organizes this event cannot judge it.
 */
judgingAdminRouter.post("/judges", async (req, res) => {
  const event = await staffEvent(req);
  const body = InviteBody.parse(req.body);
  const trackIds = await validTracks(event.id, body.trackIds);

  let user = await prisma.user.findUnique({ where: { email: body.email } });
  if (user) {
    const roles = await prisma.eventRole.findMany({ where: { eventId: event.id, userId: user.id } });
    if (roles.some((r) => r.role === "judge")) throw new HttpError(409, "already_judge", "This person is already a judge of this event.");
    if (roles.some((r) => r.role === "participant") || (await prisma.teamMember.findUnique({ where: { eventId_userId: { eventId: event.id, userId: user.id } } })))
      throw new HttpError(409, "judge_conflict", "This person is taking part in this event, so they can't judge it.");
    if (roles.some((r) => r.role === "organizer")) throw new HttpError(409, "role_conflict", "Organizers can't also judge the same event.");
  }

  const setupToken = !user?.passwordHash ? randomToken() : null;
  const result = await prisma.$transaction(async (tx) => {
    user ??= await tx.user.create({ data: { email: body.email, name: body.name ?? body.email.split("@")[0]! } });
    await tx.eventRole.create({ data: { eventId: event.id, userId: user.id, role: "judge" } });
    if (trackIds.length) await tx.judgeTrack.createMany({ data: trackIds.map((trackId) => ({ eventId: event.id, userId: user!.id, trackId })) });
    if (setupToken) {
      await tx.passwordReset.create({ data: { userId: user.id, tokenHash: sha256(setupToken), expiresAt: new Date(Date.now() + 7 * 86_400_000) } });
    }
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "judge.invite", entityType: "User", entityId: user.id, after: { email: body.email, trackIds } });
    return user;
  });

  let emailed = false;
  if (body.sendEmail) {
    emailed = await sendMail({
      to: result.email,
      subject: `You're invited to judge ${event.name}`,
      heading: `Judge ${event.name}`,
      body: [
        `${req.actor!.name} invited you to be a judge.`,
        setupToken
          ? "Set a password to activate your account. The link works once and expires in 7 days."
          : "Log in to see the projects assigned to you once judging opens.",
      ],
      action: setupToken ? { label: "Set up my account", url: absoluteUrl(`/reset/${setupToken}`) } : { label: "Open the event", url: absoluteUrl(`/events/${event.slug}`) },
    });
  }
  res.status(201).json({ judge: { id: result.id, name: result.name, email: result.email, trackIds }, emailed });
});

judgingAdminRouter.patch("/judges/:userId", async (req, res) => {
  const event = await staffEvent(req);
  const userId = (req.params as { userId: string }).userId;
  const role = await prisma.eventRole.findFirst({ where: { eventId: event.id, userId, role: "judge" } });
  if (!role) throw notFound("Judge");
  const { trackIds: requested } = z.object({ trackIds: z.array(z.uuid()).max(100) }).parse(req.body);
  const trackIds = await validTracks(event.id, requested);

  const before = (await prisma.judgeTrack.findMany({ where: { eventId: event.id, userId } })).map((t) => t.trackId);
  // Narrowing a judge's tracks must not strand work they were already given.
  if (trackIds.length) {
    const stranded = await prisma.assignment.count({
      where: { eventId: event.id, judgeId: userId, status: { not: "recused" }, project: { OR: [{ trackId: null }, { trackId: { notIn: trackIds } }] } },
    });
    if (stranded) throw new HttpError(409, "judge_has_assignments", `This judge has ${stranded} assigned project(s) outside those tracks. Reassign them first.`);
  }
  await prisma.$transaction(async (tx) => {
    await tx.judgeTrack.deleteMany({ where: { eventId: event.id, userId } });
    if (trackIds.length) await tx.judgeTrack.createMany({ data: trackIds.map((trackId) => ({ eventId: event.id, userId, trackId })) });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "judge.tracks_changed", entityType: "User", entityId: userId, before: { trackIds: before }, after: { trackIds } });
  });
  res.json({ judge: { id: userId, trackIds } });
});

/** Remove a judge who hasn't submitted anything. A judge with submitted reviews stays, for the record; exclude them from results instead. */
judgingAdminRouter.delete("/judges/:userId", async (req, res) => {
  const event = await staffEvent(req);
  const userId = (req.params as { userId: string }).userId;
  const role = await prisma.eventRole.findFirst({ where: { eventId: event.id, userId, role: "judge" } });
  if (!role) throw notFound("Judge");
  const submitted = await prisma.review.count({ where: { eventId: event.id, judgeId: userId, status: "submitted" } });
  if (submitted) throw new HttpError(409, "judge_has_reviews", `This judge has submitted ${submitted} review(s). Their record is kept; exclude them from results instead.`);
  await prisma.$transaction(async (tx) => {
    const removed = await tx.assignment.deleteMany({ where: { eventId: event.id, judgeId: userId } });
    await tx.judgeTrack.deleteMany({ where: { eventId: event.id, userId } });
    await tx.conflictOfInterest.deleteMany({ where: { eventId: event.id, judgeId: userId } });
    await tx.eventRole.delete({ where: { eventId_userId_role: { eventId: event.id, userId, role: "judge" } } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "judge.remove", entityType: "User", entityId: userId, after: { assignmentsRemoved: removed.count } });
  });
  res.status(204).end();
});

// ── teams (for conflict-of-interest pickers) ────────────────────────────────

judgingAdminRouter.get("/teams", async (req, res) => {
  const event = await staffEvent(req);
  const teams = await prisma.team.findMany({
    where: { eventId: event.id },
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, externalId: true,
      members: { select: { user: { select: { name: true, email: true } } } },
      projects: { where: { status: { not: "withdrawn" } }, select: { id: true, title: true, status: true } },
    },
  });
  res.json({ teams: teams.map((t) => ({ ...t, members: t.members.map((m) => m.user) })) });
});

// ── conflicts of interest ───────────────────────────────────────────────────

judgingAdminRouter.get("/conflicts", async (req, res) => {
  const event = await staffEvent(req);
  const rows = await prisma.conflictOfInterest.findMany({
    where: { eventId: event.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, source: true, note: true, createdAt: true, judge: { select: { id: true, name: true } }, team: { select: { id: true, name: true } } },
  });
  res.json({ conflicts: rows });
});

judgingAdminRouter.post("/conflicts", async (req, res) => {
  const event = await staffEvent(req);
  const body = z.object({ judgeId: z.uuid(), teamId: z.uuid(), note: z.string().trim().max(500).default("") }).parse(req.body);
  const [judge, team] = await Promise.all([
    prisma.eventRole.findFirst({ where: { eventId: event.id, userId: body.judgeId, role: "judge" } }),
    prisma.team.findFirst({ where: { id: body.teamId, eventId: event.id } }),
  ]);
  if (!judge) throw new HttpError(400, "invalid_judge", "That person isn't a judge of this event.");
  if (!team) throw new HttpError(400, "invalid_team", "That team isn't in this event.");

  const conflict = await prisma.$transaction(async (tx) => {
    const c = await tx.conflictOfInterest.upsert({
      where: { eventId_judgeId_teamId: { eventId: event.id, judgeId: body.judgeId, teamId: body.teamId } },
      update: { note: body.note },
      create: { eventId: event.id, judgeId: body.judgeId, teamId: body.teamId, source: "declared", note: body.note },
    });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "conflict.add", entityType: "ConflictOfInterest", entityId: c.id, after: body });
    return c;
  });
  // Existing assignments that now violate the conflict are reported, not silently deleted:
  // the organizer decides (reassignment lives in the assignment tools).
  const affected = await prisma.assignment.count({
    where: { eventId: event.id, judgeId: body.judgeId, status: { not: "recused" }, project: { teamId: body.teamId } },
  });
  res.status(201).json({ conflict, affectedAssignments: affected });
});

judgingAdminRouter.delete("/conflicts/:conflictId", async (req, res) => {
  const event = await staffEvent(req);
  const c = await prisma.conflictOfInterest.findFirst({ where: { id: (req.params as { conflictId: string }).conflictId, eventId: event.id } });
  if (!c) throw notFound("Conflict");
  await prisma.$transaction(async (tx) => {
    await tx.conflictOfInterest.delete({ where: { id: c.id } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "conflict.remove", entityType: "ConflictOfInterest", entityId: c.id, before: { judgeId: c.judgeId, teamId: c.teamId } });
  });
  res.status(204).end();
});
