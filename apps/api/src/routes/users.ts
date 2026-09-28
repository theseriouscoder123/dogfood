// Public profiles: GET /api/users/:ref (a handle, or a user id).
// Shows only what's already public elsewhere: published events, submitted projects, published
// placements, and current certificates. Never an email.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { notFound } from "../lib/http";
import { ensureHandle } from "../users/profile";

export const usersRouter = Router();

usersRouter.get("/:ref", async (req, res) => {
  const ref = req.params.ref.toLowerCase();
  const user = await prisma.user.findFirst({
    where: z.uuid().safeParse(ref).success ? { id: ref } : { handle: ref },
    select: { id: true, name: true, handle: true, headline: true, bio: true, avatarUrl: true, location: true, website: true, githubUrl: true, linkedinUrl: true, skills: true, createdAt: true },
  });
  if (!user) throw notFound("Person");
  const handle = await ensureHandle(user);

  const [roles, memberships, records] = await Promise.all([
    prisma.eventRole.findMany({
      where: { userId: user.id, event: { publishedAt: { not: null } } },
      select: { role: true, event: { select: { id: true, slug: true, name: true, logoUrl: true, submissionsCloseAt: true, publishedRunId: true } } },
    }),
    prisma.teamMember.findMany({
      where: { userId: user.id, event: { publishedAt: { not: null } } },
      select: {
        eventId: true,
        team: { select: { name: true, projects: { where: { status: "submitted", duplicateOfId: null }, select: { id: true, title: true, tagline: true, thumbnailUrl: true } } } },
      },
    }),
    prisma.signedRecord.findMany({ where: { userId: user.id, supersededById: null, revokedAt: null }, select: { id: true, type: true, issuedAt: true, event: { select: { slug: true, name: true } } }, orderBy: { issuedAt: "desc" } }),
  ]);

  const events = new Map<string, { event: (typeof roles)[number]["event"]; roles: string[] }>();
  for (const r of roles) {
    const e = events.get(r.event.id) ?? { event: r.event, roles: [] };
    e.roles.push(r.role);
    events.set(r.event.id, e);
  }
  const runIds = [...events.values()].map((e) => e.event.publishedRunId).filter((x): x is string => !!x);
  const placements = runIds.length ? await prisma.projectResult.findMany({ where: { runId: { in: runIds }, rank: { not: null } }, select: { runId: true, projectId: true, rank: true } }) : [];
  const ranked = await prisma.projectResult.groupBy({ by: ["runId"], where: { runId: { in: runIds }, rank: { not: null } }, _count: { _all: true } }).catch(() => []);

  const history = [...events.values()]
    .map(({ event, roles }) => {
      const m = memberships.find((x) => x.eventId === event.id);
      const project = m?.team.projects[0] ?? null;
      const place = project ? placements.find((p) => p.projectId === project.id && p.runId === event.publishedRunId) : undefined;
      return {
        event: { slug: event.slug, name: event.name, logoUrl: event.logoUrl, endedAt: event.submissionsCloseAt },
        roles: roles.sort(),
        team: m ? m.team.name : null,
        project,
        placement: place ? { rank: place.rank!, of: ranked.find((r) => r.runId === place.runId)?._count._all ?? 0 } : null,
      };
    })
    .sort((a, b) => b.event.endedAt.getTime() - a.event.endedAt.getTime());

  const { id, createdAt, ...rest } = user;
  res.json({
    user: { id, ...rest, handle, joinedAt: createdAt },
    stats: {
      hackathons: history.length,
      projects: history.filter((h) => h.project).length,
      podiums: history.filter((h) => h.placement && h.placement.rank <= 3).length,
      judged: history.filter((h) => h.roles.includes("judge")).length,
    },
    history,
    certificates: records.map((r) => ({ id: r.id, type: r.type, issuedAt: r.issuedAt, event: r.event })),
  });
});
