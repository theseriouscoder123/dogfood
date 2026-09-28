// Event setup: creating events, editing dates and details, tracks, prizes and organizers.
// Everything here is organizer/admin only, except self-registration as a participant.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { config } from "../config";
import { accessFor, decideCreateEvent, decideOrganize, decideParticipate, enforce, registrationWindow } from "../policy";
import { appendAudit, fromRequest } from "../audit";
import { eventBySlug } from "../lib/events";
import { HttpError, notFound } from "../lib/http";
import { scheduleProblems } from "../lib/schedule";
import { optionalImage } from "../lib/validation";

export const eventAdminRouter = Router();

const isoDate = z.iso.datetime({ offset: true }).transform((s) => new Date(s));
const nullableDate = isoDate.nullable();

export const EventFields = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500),
  tagline: z.string().trim().max(160),
  location: z.string().trim().min(1).max(120),
  overview: z.string().max(50_000),
  rules: z.string().max(50_000),
  bannerUrl: optionalImage,
  logoUrl: optionalImage,
  timezone: z.string().trim().min(1).max(64),
  registrationOpensAt: nullableDate,
  submissionsOpenAt: isoDate,
  submissionsCloseAt: isoDate,
  judgingOpensAt: nullableDate,
  judgingClosesAt: nullableDate,
  maxTeamSize: z.number().int().min(1).max(50),
});

export const CreateEvent = EventFields.partial({
  description: true, tagline: true, location: true, overview: true, rules: true, bannerUrl: true, logoUrl: true,
  timezone: true, registrationOpensAt: true, judgingOpensAt: true, judgingClosesAt: true, maxTeamSize: true,
}).extend({
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase letters, digits and dashes").max(60).optional(),
});

const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "event";

async function freeSlug(base: string): Promise<string> {
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    if (!(await prisma.event.findUnique({ where: { slug: candidate }, select: { id: true } }))) return candidate;
  }
}

function assertSchedule(s: Parameters<typeof scheduleProblems>[0]) {
  const problems = scheduleProblems(s);
  if (problems.length) throw new HttpError(400, "invalid_schedule", problems.join("; "), problems);
}

async function staffEvent(req: import("express").Request) {
  const event = await eventBySlug(req.params.slug as string | undefined);
  enforce(decideOrganize(await accessFor(req.actor, event.id)));
  return event;
}

// ── events ──────────────────────────────────────────────────────────────────

eventAdminRouter.post("/", async (req, res) => {
  enforce(decideCreateEvent(req.actor, config.hosting));
  const body = CreateEvent.parse(req.body);
  const schedule = {
    registrationOpensAt: body.registrationOpensAt ?? null,
    submissionsOpenAt: body.submissionsOpenAt,
    submissionsCloseAt: body.submissionsCloseAt,
    judgingOpensAt: body.judgingOpensAt ?? null,
    judgingClosesAt: body.judgingClosesAt ?? null,
  };
  assertSchedule(schedule);
  if (body.slug && (await prisma.event.findUnique({ where: { slug: body.slug } })))
    throw new HttpError(409, "slug_taken", "That URL is already used by another event.");
  const slug = body.slug ?? (await freeSlug(slugify(body.name)));

  const event = await prisma.$transaction(async (tx) => {
    const created = await tx.event.create({
      data: {
        ...schedule, slug, name: body.name,
        description: body.description ?? "", tagline: body.tagline ?? "", location: body.location ?? "Online",
        overview: body.overview ?? "", rules: body.rules ?? "", bannerUrl: body.bannerUrl ?? null, logoUrl: body.logoUrl ?? null,
        timezone: body.timezone ?? "UTC", maxTeamSize: body.maxTeamSize ?? 4,
        publishedAt: null, // a draft until its organizers publish it
        createdById: req.actor!.id,
      },
    });
    await tx.eventRole.create({ data: { eventId: created.id, userId: req.actor!.id, role: "organizer" } });
    await appendAudit(tx, { ...fromRequest(req), eventId: created.id, action: "event.create", entityType: "Event", entityId: created.id, after: created });
    return created;
  });
  res.status(201).json({ event: { slug: event.slug, name: event.name } });
});

export const UpdateEventBody = EventFields.partial();

eventAdminRouter.patch("/:slug", async (req, res) => {
  const event = await staffEvent(req);
  const body = UpdateEventBody.parse(req.body);
  const next = { ...event, ...body };
  assertSchedule(next);

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.event.update({ where: { id: event.id }, data: body });
    const changed = Object.keys(body) as Array<keyof typeof body>;
    await appendAudit(tx, {
      ...fromRequest(req), eventId: event.id, action: "event.update", entityType: "Event", entityId: event.id,
      before: Object.fromEntries(changed.map((k) => [k, event[k]])),
      after: Object.fromEntries(changed.map((k) => [k, u[k]])),
    });
    return u;
  });
  res.json({ event: { slug: updated.slug, name: updated.name } });
});

/** Make a draft event public: it appears in listings and people can register. */
eventAdminRouter.post("/:slug/publish", async (req, res) => {
  const event = await staffEvent(req);
  if (event.publishedAt) {
    res.json({ publishedAt: event.publishedAt });
    return;
  }
  const u = await prisma.$transaction(async (tx) => {
    const u = await tx.event.update({ where: { id: event.id }, data: { publishedAt: new Date() } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "event.published", entityType: "Event", entityId: event.id });
    return u;
  });
  res.json({ publishedAt: u.publishedAt });
});

/** Back to draft: only while nobody has joined, so no one loses access to something they're part of. */
eventAdminRouter.post("/:slug/unpublish", async (req, res) => {
  const event = await staffEvent(req);
  const joined = await prisma.eventRole.count({ where: { eventId: event.id, role: { in: ["participant", "judge"] } } });
  if (joined > 0) throw new HttpError(409, "event_has_people", "People have already joined this event, so it can't go back to draft.");
  await prisma.$transaction(async (tx) => {
    await tx.event.update({ where: { id: event.id }, data: { publishedAt: null } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "event.unpublished", entityType: "Event", entityId: event.id });
  });
  res.json({ publishedAt: null });
});

// ── participant self-registration ───────────────────────────────────────────

eventAdminRouter.post("/:slug/register", async (req, res) => {
  const event = await eventBySlug(req.params.slug);
  const access = await accessFor(req.actor, event.id);
  enforce(decideParticipate(access, registrationWindow(event)));
  if (access.roles.has("participant")) {
    res.json({ registered: true });
    return;
  }
  await prisma.$transaction(async (tx) => {
    await tx.eventRole.create({ data: { eventId: event.id, userId: access.actor!.id, role: "participant" } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "event.register", entityType: "EventRole", entityId: access.actor!.id });
  });
  res.status(201).json({ registered: true });
});

// ── tracks ──────────────────────────────────────────────────────────────────

export const TrackBody = z.object({ name: z.string().trim().min(1).max(80), description: z.string().max(2000).default("") });

eventAdminRouter.post("/:slug/tracks", async (req, res) => {
  const event = await staffEvent(req);
  const body = TrackBody.parse(req.body);
  const track = await prisma.$transaction(async (tx) => {
    const t = await tx.track.create({ data: { ...body, eventId: event.id } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "track.create", entityType: "Track", entityId: t.id, after: t });
    return t;
  });
  res.status(201).json({ track });
});

eventAdminRouter.patch("/:slug/tracks/:trackId", async (req, res) => {
  const event = await staffEvent(req);
  const body = TrackBody.partial().parse(req.body);
  const track = await prisma.track.findFirst({ where: { id: req.params.trackId, eventId: event.id } });
  if (!track) throw notFound("Track");
  const updated = await prisma.$transaction(async (tx) => {
    const t = await tx.track.update({ where: { id: track.id }, data: body });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "track.update", entityType: "Track", entityId: t.id, before: track, after: t });
    return t;
  });
  res.json({ track: updated });
});

eventAdminRouter.delete("/:slug/tracks/:trackId", async (req, res) => {
  const event = await staffEvent(req);
  const track = await prisma.track.findFirst({ where: { id: req.params.trackId, eventId: event.id }, include: { _count: { select: { projects: true } } } });
  if (!track) throw notFound("Track");
  if (track._count.projects > 0)
    throw new HttpError(409, "track_in_use", `${track._count.projects} project(s) are in this track. Move them first.`);
  await prisma.$transaction(async (tx) => {
    await tx.track.delete({ where: { id: track.id } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "track.delete", entityType: "Track", entityId: track.id, before: { name: track.name } });
  });
  res.status(204).end();
});

// ── prizes ──────────────────────────────────────────────────────────────────

export const PrizeBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).default(""),
  value: z.string().trim().max(120).default(""),
  rank: z.number().int().min(1).max(1000).nullable().default(null),
  trackId: z.uuid().nullable().default(null),
});

async function assertTrackInEvent(trackId: string | null | undefined, eventId: string) {
  if (!trackId) return;
  if (!(await prisma.track.findFirst({ where: { id: trackId, eventId }, select: { id: true } })))
    throw new HttpError(400, "invalid_track", "That track does not belong to this event.");
}

eventAdminRouter.post("/:slug/prizes", async (req, res) => {
  const event = await staffEvent(req);
  const body = PrizeBody.parse(req.body);
  await assertTrackInEvent(body.trackId, event.id);
  const prize = await prisma.$transaction(async (tx) => {
    const p = await tx.prize.create({ data: { ...body, eventId: event.id } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "prize.create", entityType: "Prize", entityId: p.id, after: p });
    return p;
  });
  res.status(201).json({ prize });
});

eventAdminRouter.patch("/:slug/prizes/:prizeId", async (req, res) => {
  const event = await staffEvent(req);
  const body = PrizeBody.partial().parse(req.body);
  await assertTrackInEvent(body.trackId, event.id);
  const prize = await prisma.prize.findFirst({ where: { id: req.params.prizeId, eventId: event.id } });
  if (!prize) throw notFound("Prize");
  const updated = await prisma.$transaction(async (tx) => {
    const p = await tx.prize.update({ where: { id: prize.id }, data: body });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "prize.update", entityType: "Prize", entityId: p.id, before: prize, after: p });
    return p;
  });
  res.json({ prize: updated });
});

eventAdminRouter.delete("/:slug/prizes/:prizeId", async (req, res) => {
  const event = await staffEvent(req);
  const prize = await prisma.prize.findFirst({ where: { id: req.params.prizeId, eventId: event.id } });
  if (!prize) throw notFound("Prize");
  await prisma.$transaction(async (tx) => {
    await tx.prize.delete({ where: { id: prize.id } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "prize.delete", entityType: "Prize", entityId: prize.id, before: prize });
  });
  res.status(204).end();
});

// ── organizers ──────────────────────────────────────────────────────────────

eventAdminRouter.get("/:slug/organizers", async (req, res) => {
  const event = await staffEvent(req);
  const rows = await prisma.eventRole.findMany({
    where: { eventId: event.id, role: "organizer" },
    select: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  res.json({ organizers: rows.map((r) => r.user) });
});

export const AddOrganizerBody = z.object({ email: z.email().transform((s) => s.trim().toLowerCase()) });

eventAdminRouter.post("/:slug/organizers", async (req, res) => {
  const event = await staffEvent(req);
  const { email } = AddOrganizerBody.parse(req.body);
  const result = await prisma.$transaction(async (tx) => {
    // Unknown people get a password-less account; they claim it by registering with the same email.
    const user = await tx.user.upsert({ where: { email }, update: {}, create: { email, name: email.split("@")[0]! } });
    const judge = await tx.eventRole.findUnique({ where: { eventId_userId_role: { eventId: event.id, userId: user.id, role: "judge" } } });
    if (judge) throw new HttpError(409, "role_conflict", "This person is a judge of this event.");
    await tx.eventRole.upsert({
      where: { eventId_userId_role: { eventId: event.id, userId: user.id, role: "organizer" } },
      update: {},
      create: { eventId: event.id, userId: user.id, role: "organizer" },
    });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "organizer.add", entityType: "User", entityId: user.id, after: { email } });
    return { id: user.id, name: user.name, email: user.email };
  });
  res.status(201).json({ organizer: result });
});

eventAdminRouter.delete("/:slug/organizers/:userId", async (req, res) => {
  const event = await staffEvent(req);
  const count = await prisma.eventRole.count({ where: { eventId: event.id, role: "organizer" } });
  const target = await prisma.eventRole.findUnique({
    where: { eventId_userId_role: { eventId: event.id, userId: req.params.userId, role: "organizer" } },
  });
  if (!target) throw notFound("Organizer");
  if (count <= 1) throw new HttpError(409, "last_organizer", "An event needs at least one organizer.");
  await prisma.$transaction(async (tx) => {
    await tx.eventRole.delete({ where: { eventId_userId_role: { eventId: event.id, userId: target.userId, role: "organizer" } } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "organizer.remove", entityType: "User", entityId: target.userId });
  });
  res.status(204).end();
});

// ── custom submission questions ─────────────────────────────────────────────

export const QuestionBody = z
  .object({
    label: z.string().trim().min(1).max(200),
    help: z.string().max(1000).default(""),
    type: z.enum(["short_text", "long_text", "url", "single_select", "checkbox"]),
    options: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
    required: z.boolean().default(false),
    isPublic: z.boolean().default(true),
    position: z.number().int().min(0).max(1000).optional(),
  })
  .refine((q) => q.type !== "single_select" || q.options.length >= 2, { message: "A choice question needs at least two options.", path: ["options"] });

eventAdminRouter.post("/:slug/questions", async (req, res) => {
  const event = await staffEvent(req);
  const body = QuestionBody.parse(req.body);
  const position = body.position ?? (await prisma.submissionQuestion.count({ where: { eventId: event.id } }));
  const question = await prisma.$transaction(async (tx) => {
    const q = await tx.submissionQuestion.create({ data: { ...body, options: body.type === "single_select" ? body.options : [], position, eventId: event.id } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "question.create", entityType: "SubmissionQuestion", entityId: q.id, after: q });
    return q;
  });
  res.status(201).json({ question });
});

eventAdminRouter.patch("/:slug/questions/:questionId", async (req, res) => {
  const event = await staffEvent(req);
  const existing = await prisma.submissionQuestion.findFirst({ where: { id: req.params.questionId, eventId: event.id } });
  if (!existing) throw notFound("Question");
  const merged = QuestionBody.parse({ ...existing, ...req.body });
  const updated = await prisma.$transaction(async (tx) => {
    const q = await tx.submissionQuestion.update({
      where: { id: existing.id },
      data: { ...merged, options: merged.type === "single_select" ? merged.options : [], position: merged.position ?? existing.position },
    });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "question.update", entityType: "SubmissionQuestion", entityId: q.id, before: existing, after: q });
    return q;
  });
  res.json({ question: updated });
});

eventAdminRouter.delete("/:slug/questions/:questionId", async (req, res) => {
  const event = await staffEvent(req);
  const existing = await prisma.submissionQuestion.findFirst({ where: { id: req.params.questionId, eventId: event.id }, include: { _count: { select: { answers: true } } } });
  if (!existing) throw notFound("Question");
  await prisma.$transaction(async (tx) => {
    await tx.submissionQuestion.delete({ where: { id: existing.id } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "question.delete", entityType: "SubmissionQuestion", entityId: existing.id, before: { label: existing.label, answers: existing._count.answers } });
  });
  res.status(204).end();
});
