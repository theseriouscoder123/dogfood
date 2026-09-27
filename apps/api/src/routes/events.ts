import { Router } from "express";
import { prisma } from "../db";
import { accessFor, registrationWindow, submissionWindow, votingWindow } from "../policy";
import { eventBySlug } from "../lib/events";
import { scoreCount } from "./judgingAdmin";

export const eventsRouter = Router();

/** Public event listing, with what an event card needs (branding, counts, prize summary). */
eventsRouter.get("/", async (_req, res) => {
  const events = await prisma.event.findMany({
    orderBy: { submissionsCloseAt: "desc" },
    select: {
      id: true, slug: true, name: true, description: true, tagline: true, location: true, bannerUrl: true, logoUrl: true,
      registrationOpensAt: true, submissionsOpenAt: true, submissionsCloseAt: true, judgingOpensAt: true, judgingClosesAt: true,
      tracks: { select: { name: true }, orderBy: { name: "asc" } },
      prizes: { select: { value: true } },
      _count: { select: { projects: { where: { status: "submitted", duplicateOfId: null } } } },
    },
  });
  const participants = await prisma.eventRole.groupBy({ by: ["eventId"], where: { role: "participant" }, _count: { _all: true } });
  const participantCount = new Map(participants.map((p) => [p.eventId, p._count._all]));

  res.json({
    events: events.map(({ _count, id, tracks, prizes, ...e }) => ({
      ...e,
      submissionWindow: submissionWindow(e),
      registrationWindow: registrationWindow(e),
      projectCount: _count.projects,
      participantCount: participantCount.get(id) ?? 0,
      tracks: tracks.map((t) => t.name),
      prizeCount: prizes.length,
      prizeTotal: prizeTotal(prizes.map((p) => p.value)),
    })),
  });
});

/** "$500", "$1,000 + swag" … → "$1,500" when every value is in the same currency; otherwise null. */
function prizeTotal(values: string[]): string | null {
  let currency: string | null = null;
  let total = 0;
  for (const v of values) {
    const m = v.match(/^\s*([$€£₹])\s?([\d,]+(?:\.\d+)?)/);
    if (!m) continue;
    if (currency && currency !== m[1]) return null;
    currency = m[1]!;
    total += Number(m[2]!.replace(/,/g, ""));
  }
  return currency && total > 0 ? `${currency}${total.toLocaleString("en-US")}` : null;
}

eventsRouter.get("/:slug", async (req, res) => {
  const event = await eventBySlug(req.params.slug);
  const [tracks, prizes, criteria, questions, access, participantCount, teamCount, projectCount, scores] = await Promise.all([
    prisma.track.findMany({
      where: { eventId: event.id }, orderBy: { name: "asc" },
      select: { id: true, externalId: true, name: true, description: true, _count: { select: { projects: { where: { status: "submitted", duplicateOfId: null } } } } },
    }),
    prisma.prize.findMany({ where: { eventId: event.id }, orderBy: [{ rank: "asc" }, { name: "asc" }] }),
    prisma.criterion.findMany({ where: { eventId: event.id }, orderBy: { position: "asc" } }),
    prisma.submissionQuestion.findMany({ where: { eventId: event.id }, orderBy: { position: "asc" } }),
    accessFor(req.actor, event.id),
    prisma.eventRole.count({ where: { eventId: event.id, role: "participant" } }),
    prisma.team.count({ where: { eventId: event.id } }),
    prisma.project.count({ where: { eventId: event.id, status: "submitted", duplicateOfId: null } }),
    scoreCount(event.id),
  ]);
  res.json({
    event: {
      slug: event.slug, name: event.name, description: event.description, tagline: event.tagline, location: event.location,
      overview: event.overview, rules: event.rules, bannerUrl: event.bannerUrl, logoUrl: event.logoUrl, timezone: event.timezone,
      registrationOpensAt: event.registrationOpensAt, submissionsOpenAt: event.submissionsOpenAt,
      submissionsCloseAt: event.submissionsCloseAt, judgingOpensAt: event.judgingOpensAt,
      judgingClosesAt: event.judgingClosesAt, maxTeamSize: event.maxTeamSize,
      submissionWindow: submissionWindow(event),
      registrationWindow: registrationWindow(event),
      resultsPublished: event.publishedRunId !== null,
      votingOpensAt: event.votingOpensAt,
      votingClosesAt: event.votingClosesAt,
      votingWindow: votingWindow(event),
      votingMode: event.votingMode,
      votesPerVoter: event.votesPerVoter,
      votingPublished: event.votingPublishedAt !== null,
    },
    stats: { participants: participantCount, teams: teamCount, projects: projectCount, prizeTotal: prizeTotal(prizes.map((p) => p.value)) },
    tracks: tracks.map(({ _count, ...t }) => ({ ...t, projectCount: _count.projects })),
    prizes: prizes.map((p) => ({ id: p.id, trackId: p.trackId, name: p.name, description: p.description, value: p.value, rank: p.rank })),
    rubricLocked: scores > 0,
    criteria: criteria.map((c) => ({ id: c.id, key: c.key, label: c.label, description: c.description, weight: Number(c.weight), minScore: c.minScore, maxScore: c.maxScore })),
    questions: questions.map((q) => ({ id: q.id, label: q.label, help: q.help, type: q.type, options: q.options, required: q.required, isPublic: q.isPublic, position: q.position })),
    myRoles: [...access.roles],
  });
});
