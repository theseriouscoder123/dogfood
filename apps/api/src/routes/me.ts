// The signed-in person's own views: the dashboard (everything they're part of, by role).
// Mounted at /api/me.
import { Router } from "express";
import { prisma } from "../db";
import { unauthenticated } from "../lib/http";
import { reviewTarget } from "./progress";

export const meRouter = Router();

const eventCard = { slug: true, name: true, tagline: true, logoUrl: true, publishedAt: true, bannerUrl: true, registrationOpensAt: true, submissionsOpenAt: true, submissionsCloseAt: true, judgingOpensAt: true, judgingClosesAt: true, votingOpensAt: true, votingClosesAt: true } as const;

/** One call for the dashboard: each event the caller has a role in, with what matters for that role. */
meRouter.get("/dashboard", async (req, res) => {
  if (!req.actor) throw unauthenticated();
  const userId = req.actor.id;
  const roles = await prisma.eventRole.findMany({ where: { userId }, select: { role: true, eventId: true } });
  const eventIds = [...new Set(roles.map((r) => r.eventId))];
  const events = await prisma.event.findMany({ where: { id: { in: eventIds } }, select: { id: true, ...eventCard } });

  const out = await Promise.all(
    events.map(async (e) => {
      const mine = new Set(roles.filter((r) => r.eventId === e.id).map((r) => r.role));
      const [membership, judging, organizing] = await Promise.all([
        mine.has("participant")
          ? prisma.teamMember.findUnique({
              where: { eventId_userId: { eventId: e.id, userId } },
              select: { role: true, team: { select: { id: true, name: true, _count: { select: { members: true } }, projects: { where: { duplicateOfId: null, status: { not: "withdrawn" } }, select: { id: true, title: true, status: true, updatedAt: true }, take: 1 } } } },
            })
          : null,
        mine.has("judge") ? prisma.assignment.groupBy({ by: ["status"], where: { eventId: e.id, judgeId: userId }, _count: { _all: true } }) : null,
        mine.has("organizer")
          ? Promise.all([
              prisma.eventRole.count({ where: { eventId: e.id, role: "participant" } }),
              prisma.project.count({ where: { eventId: e.id, status: "submitted", duplicateOfId: null } }),
              prisma.project.count({ where: { eventId: e.id, status: "draft" } }),
              prisma.review.count({ where: { eventId: e.id, status: "submitted" } }),
              prisma.eventRole.count({ where: { eventId: e.id, role: "judge" } }),
              reviewTarget(e.id),
              prisma.comment.count({ where: { eventId: e.id, deletedAt: null, reports: { some: { resolvedAt: null } } } }),
            ])
          : null,
      ]);
      const judgeCounts = judging ? Object.fromEntries(judging.map((g) => [g.status, g._count._all])) : null;
      const { id: _id, ...card } = e;
      return {
        ...card,
        roles: [...mine],
        participant: mine.has("participant")
          ? { team: membership ? { id: membership.team.id, name: membership.team.name, members: membership.team._count.members, role: membership.role } : null, project: membership?.team.projects[0] ?? null }
          : null,
        judge: judgeCounts
          ? { assigned: Object.values(judgeCounts).reduce((a, b) => a + b, 0) - (judgeCounts.recused ?? 0), submitted: judgeCounts.submitted ?? 0, inProgress: judgeCounts.in_progress ?? 0 }
          : null,
        organizer: organizing
          ? (() => {
              const [participants, submitted, drafts, reviews, judges, target, reported] = organizing;
              return { participants, submitted, drafts, reviews, reviewsExpected: submitted * Math.min(target, Math.max(judges, 1)), judges, reported };
            })()
          : null,
      };
    }),
  );
  res.json({ events: out.sort((a, b) => b.submissionsCloseAt.getTime() - a.submissionsCloseAt.getTime()) });
});
