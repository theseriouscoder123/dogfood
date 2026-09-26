import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { accessFor, decideWriteSubmission, enforce, submissionWindow } from "../policy";
import { appendAudit, audit, fromRequest } from "../audit";
import { eventBySlug } from "../lib/events";
import { HttpError } from "../lib/http";

export const projectsRouter = Router({ mergeParams: true });

const GalleryQuery = z.object({
  q: z.string().trim().max(100).optional(),
  track: z.string().trim().max(100).optional(), // track id or its imported external id
});

/** Public gallery: submitted, non-duplicate projects. No auth required. */
projectsRouter.get("/", async (req, res) => {
  const event = await eventBySlug((req.params as { slug?: string }).slug);
  const { q, track } = GalleryQuery.parse(req.query);

  const where: Prisma.ProjectWhereInput = { eventId: event.id, status: "submitted", duplicateOfId: null };
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { tagline: { contains: q, mode: "insensitive" } },
      { techTags: { has: q.toLowerCase() } },
    ];
  }
  if (track) {
    const isUuid = /^[0-9a-f-]{36}$/i.test(track);
    where.track = isUuid ? { id: track } : { externalId: track };
  }

  const projects = await prisma.project.findMany({
    where,
    orderBy: [{ title: "asc" }, { id: "asc" }],
    select: {
      id: true, externalId: true, title: true, tagline: true, repoUrl: true, demoUrl: true,
      videoUrl: true, thumbnailUrl: true, techTags: true, submittedAt: true,
      track: { select: { id: true, externalId: true, name: true } },
      team: { select: { id: true, name: true } },
    },
  });
  res.json({ event: { slug: event.slug, name: event.name }, total: projects.length, projects });
});

const CreateProjectBody = z.object({
  title: z.string().trim().min(1).max(120),
  tagline: z.string().trim().max(200).default(""),
  description: z.string().max(20_000).default(""),
  trackId: z.uuid().optional(),
  repoUrl: z.url().optional(),
  demoUrl: z.url().optional(),
  videoUrl: z.url().optional(),
  techTags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20).default([]),
});

/** Create a draft for the caller's team. Deadline is checked before anything else about the request. */
projectsRouter.post("/", async (req, res) => {
  const event = await eventBySlug((req.params as { slug?: string }).slug);
  const access = await accessFor(req.actor, event.id);
  const decision = decideWriteSubmission(access, submissionWindow(event));
  if (decision === "closed" || decision === "not_open") {
    // Late attempts are evidence of deadline gaming; keep a record the organizer can read.
    await audit({ ...fromRequest(req), eventId: event.id, action: "submission.refused_" + decision, entityType: "Project", after: { title: req.body?.title ?? null } });
  }
  enforce(decision);
  const actor = access.actor!;

  const membership = await prisma.teamMember.findUnique({
    where: { eventId_userId: { eventId: event.id, userId: actor.id } },
  });
  if (!membership) throw new HttpError(403, "not_on_team", "Join or create a team before submitting.");

  const body = CreateProjectBody.parse(req.body);
  if (body.trackId) {
    const track = await prisma.track.findFirst({ where: { id: body.trackId, eventId: event.id } });
    if (!track) throw new HttpError(400, "invalid_track", "That track does not belong to this event.");
  }

  const project = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: { ...body, eventId: event.id, teamId: membership.teamId, status: "draft" },
    });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "project.create", entityType: "Project", entityId: created.id, after: created });
    return created;
  });
  res.status(201).json({ project });
});
