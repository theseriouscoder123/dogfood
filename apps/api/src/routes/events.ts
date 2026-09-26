import { Router } from "express";
import { prisma } from "../db";
import { accessFor, submissionWindow } from "../policy";
import { eventBySlug } from "../lib/events";

export const eventsRouter = Router();

eventsRouter.get("/", async (_req, res) => {
  const events = await prisma.event.findMany({
    orderBy: { submissionsCloseAt: "desc" },
    select: {
      slug: true, name: true, description: true,
      submissionsOpenAt: true, submissionsCloseAt: true, judgingOpensAt: true, judgingClosesAt: true,
      _count: { select: { projects: { where: { status: "submitted", duplicateOfId: null } } } },
    },
  });
  res.json({
    events: events.map(({ _count, ...e }) => ({
      ...e,
      submissionWindow: submissionWindow(e),
      projectCount: _count.projects,
    })),
  });
});

eventsRouter.get("/:slug", async (req, res) => {
  const event = await eventBySlug(req.params.slug);
  const [tracks, prizes, criteria, access] = await Promise.all([
    prisma.track.findMany({ where: { eventId: event.id }, orderBy: { name: "asc" }, select: { id: true, externalId: true, name: true, description: true } }),
    prisma.prize.findMany({ where: { eventId: event.id }, orderBy: [{ rank: "asc" }, { name: "asc" }] }),
    prisma.criterion.findMany({ where: { eventId: event.id }, orderBy: { position: "asc" } }),
    accessFor(req.actor, event.id),
  ]);
  res.json({
    event: {
      slug: event.slug, name: event.name, description: event.description, timezone: event.timezone,
      registrationOpensAt: event.registrationOpensAt, submissionsOpenAt: event.submissionsOpenAt,
      submissionsCloseAt: event.submissionsCloseAt, judgingOpensAt: event.judgingOpensAt,
      judgingClosesAt: event.judgingClosesAt, maxTeamSize: event.maxTeamSize,
      submissionWindow: submissionWindow(event),
      resultsPublished: event.publishedRunId !== null,
    },
    tracks,
    prizes: prizes.map((p) => ({ id: p.id, trackId: p.trackId, name: p.name, description: p.description, value: p.value, rank: p.rank })),
    criteria: criteria.map((c) => ({ key: c.key, label: c.label, description: c.description, weight: Number(c.weight), minScore: c.minScore, maxScore: c.maxScore })),
    myRoles: [...access.roles],
  });
});
