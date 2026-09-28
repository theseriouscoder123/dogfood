// Event community: organizer announcements ("Updates") and the team finder.
// Mounted at /api/events/:slug.
import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { accessFor, decideOrganize, decideParticipate, enforce, registrationWindow } from "../policy";
import { appendAudit, fromRequest } from "../audit";
import { eventBySlug } from "../lib/events";
import { HttpError, notFound, unauthenticated } from "../lib/http";
import { randomToken, sha256 } from "../lib/crypto";
import { notify } from "../notifications/notify";

export const communityRouter = Router({ mergeParams: true });

const slugOf = (req: Request) => (req.params as { slug?: string }).slug;

async function staffEvent(req: Request) {
  const event = await eventBySlug(slugOf(req));
  enforce(decideOrganize(await accessFor(req.actor, event.id)));
  return event;
}

// ── announcements ───────────────────────────────────────────────────────────

export const AnnouncementBody = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(20_000).describe("Markdown."),
  pinned: z.boolean().default(false),
  notify: z.boolean().default(true).describe("Notify participants and judges (in the portal, and by email for people who want it)."),
});

const announcementView = (a: { id: string; title: string; body: string; pinned: boolean; createdAt: Date; updatedAt: Date; author: { name: string; handle: string | null; id: string; avatarUrl: string | null } | null }) => ({
  id: a.id,
  title: a.title,
  body: a.body,
  pinned: a.pinned,
  createdAt: a.createdAt,
  edited: a.updatedAt.getTime() - a.createdAt.getTime() > 1000,
  author: a.author ? { name: a.author.name, profile: a.author.handle ?? a.author.id, avatarUrl: a.author.avatarUrl } : null,
});

const authorSelect = { select: { id: true, name: true, handle: true, avatarUrl: true } } as const;

communityRouter.get("/announcements", async (req, res) => {
  const event = await eventBySlug(slugOf(req));
  const items = await prisma.announcement.findMany({ where: { eventId: event.id }, orderBy: [{ pinned: "desc" }, { createdAt: "desc" }], include: { author: authorSelect } });
  res.json({ announcements: items.map(announcementView) });
});

communityRouter.post("/announcements", async (req, res) => {
  const event = await staffEvent(req);
  const body = AnnouncementBody.parse(req.body);
  const a = await prisma.$transaction(async (tx) => {
    const a = await tx.announcement.create({ data: { eventId: event.id, authorId: req.actor!.id, title: body.title, body: body.body, pinned: body.pinned }, include: { author: authorSelect } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "announcement.posted", entityType: "Announcement", entityId: a.id, after: { title: a.title, notify: body.notify } });
    if (body.notify) {
      const people = await tx.eventRole.findMany({ where: { eventId: event.id, role: { in: ["participant", "judge"] } }, select: { userId: true }, distinct: ["userId"] });
      await notify(tx, people.map((p) => ({ userId: p.userId, eventId: event.id, category: "announcements", title: a.title, body: event.name, url: `/events/${event.slug}/updates#${a.id}` })), req.actor!.id);
    }
    return a;
  });
  res.status(201).json({ announcement: announcementView(a) });
});

async function ownAnnouncement(req: Request, eventId: string) {
  const id = (req.params as { announcementId: string }).announcementId;
  const a = z.uuid().safeParse(id).success ? await prisma.announcement.findFirst({ where: { id, eventId } }) : null;
  if (!a) throw notFound("Announcement");
  return a;
}

communityRouter.patch("/announcements/:announcementId", async (req, res) => {
  const event = await staffEvent(req);
  const a = await ownAnnouncement(req, event.id);
  const body = AnnouncementBody.omit({ notify: true }).partial().parse(req.body);
  const u = await prisma.$transaction(async (tx) => {
    const u = await tx.announcement.update({ where: { id: a.id }, data: body, include: { author: authorSelect } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "announcement.edited", entityType: "Announcement", entityId: a.id, before: { title: a.title, body: a.body, pinned: a.pinned }, after: body });
    return u;
  });
  res.json({ announcement: announcementView(u) });
});

communityRouter.delete("/announcements/:announcementId", async (req, res) => {
  const event = await staffEvent(req);
  const a = await ownAnnouncement(req, event.id);
  await prisma.$transaction(async (tx) => {
    await tx.announcement.delete({ where: { id: a.id } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "announcement.deleted", entityType: "Announcement", entityId: a.id, before: { title: a.title } });
  });
  res.status(204).end();
});

// ── team finder ─────────────────────────────────────────────────────────────

export const FinderBody = z.object({
  kind: z.enum(["individual", "team"]).describe("individual: I'm looking for a team. team: my team is looking for people."),
  note: z.string().trim().max(500).default(""),
  skills: z.array(z.string().trim().min(1).max(30)).max(12).transform((s) => [...new Set(s)]).default([]),
});

/** Open posts only: people who have since joined a team, and teams that have since filled up, drop off. */
communityRouter.get("/team-finder", async (req, res) => {
  const event = await eventBySlug(slugOf(req));
  const [posts, memberships] = await Promise.all([
    prisma.finderPost.findMany({
      where: { eventId: event.id },
      orderBy: { updatedAt: "desc" },
      include: { user: { select: { id: true, name: true, handle: true, avatarUrl: true, headline: true } } },
    }),
    prisma.teamMember.findMany({ where: { eventId: event.id }, select: { userId: true, teamId: true, team: { select: { id: true, name: true, _count: { select: { members: true } } } } } }),
  ]);
  const teamOf = new Map(memberships.map((m) => [m.userId, m.team]));
  const mine = req.actor ? teamOf.get(req.actor.id) : undefined;
  const open = posts.filter((p) => {
    const t = teamOf.get(p.userId);
    return p.kind === "individual" ? !t : !!t && t._count.members < event.maxTeamSize;
  });
  res.json({
    maxTeamSize: event.maxTeamSize,
    registrationOpen: registrationWindow(event) === "open",
    me: req.actor ? { onTeam: !!mine, teamName: mine?.name ?? null, canInvite: !!mine && mine._count.members < event.maxTeamSize, post: posts.find((p) => p.userId === req.actor!.id) ?? null } : null,
    posts: open.map((p) => {
      const t = teamOf.get(p.userId);
      return {
        id: p.id,
        kind: p.kind,
        note: p.note,
        skills: p.skills,
        updatedAt: p.updatedAt,
        mine: p.userId === req.actor?.id,
        person: { name: p.user.name, profile: p.user.handle ?? p.user.id, avatarUrl: p.user.avatarUrl, headline: p.user.headline },
        team: p.kind === "team" && t ? { name: t.name, members: t._count.members, openSpots: event.maxTeamSize - t._count.members } : null,
      };
    }),
  });
});

communityRouter.put("/team-finder", async (req, res) => {
  const event = await eventBySlug(slugOf(req));
  const access = await accessFor(req.actor, event.id);
  enforce(decideParticipate(access, registrationWindow(event)));
  const body = FinderBody.parse(req.body);
  const onTeam = await prisma.teamMember.findUnique({ where: { eventId_userId: { eventId: event.id, userId: access.actor!.id } } });
  if (body.kind === "individual" && onTeam) throw new HttpError(409, "already_on_team", "You're already on a team. Post for your team instead.");
  if (body.kind === "team" && !onTeam) throw new HttpError(409, "no_team", "Create or join a team first.");
  // Posting counts as registering, like creating a team does.
  const [post] = await prisma.$transaction([
    prisma.finderPost.upsert({
      where: { eventId_userId: { eventId: event.id, userId: access.actor!.id } },
      update: body,
      create: { ...body, eventId: event.id, userId: access.actor!.id },
    }),
    prisma.eventRole.upsert({
      where: { eventId_userId_role: { eventId: event.id, userId: access.actor!.id, role: "participant" } },
      update: {},
      create: { eventId: event.id, userId: access.actor!.id, role: "participant" },
    }),
  ]);
  res.json({ post });
});

communityRouter.delete("/team-finder", async (req, res) => {
  const event = await eventBySlug(slugOf(req));
  if (!req.actor) throw unauthenticated();
  await prisma.finderPost.deleteMany({ where: { eventId: event.id, userId: req.actor.id } });
  res.status(204).end();
});

/** A team member invites someone who's looking: they get a single-use join link as a notification. */
communityRouter.post("/team-finder/:postId/invite", async (req, res) => {
  const event = await eventBySlug(slugOf(req));
  const access = await accessFor(req.actor, event.id);
  enforce(decideParticipate(access, registrationWindow(event)));
  const me = await prisma.teamMember.findUnique({ where: { eventId_userId: { eventId: event.id, userId: access.actor!.id } }, include: { team: { include: { _count: { select: { members: true } } } } } });
  if (!me) throw new HttpError(409, "no_team", "Create or join a team first.");
  if (me.team._count.members >= event.maxTeamSize) throw new HttpError(409, "team_full", "Your team is already full.");
  const id = (req.params as { postId: string }).postId;
  const post = z.uuid().safeParse(id).success ? await prisma.finderPost.findFirst({ where: { id, eventId: event.id, kind: "individual" } }) : null;
  if (!post) throw notFound("Post");
  if (await prisma.teamMember.findUnique({ where: { eventId_userId: { eventId: event.id, userId: post.userId } } })) throw new HttpError(409, "already_on_team", "They've already joined a team.");
  const recent = await prisma.teamInvite.count({ where: { teamId: me.teamId, createdAt: { gt: new Date(Date.now() - 3_600_000) } } });
  if (recent >= 30) throw new HttpError(429, "too_many_invites", "Too many invites in the last hour.");

  const token = randomToken(24);
  await prisma.$transaction(async (tx) => {
    const i = await tx.teamInvite.create({ data: { teamId: me.teamId, tokenHash: sha256(token), createdById: access.actor!.id, maxUses: 1, expiresAt: new Date(Date.now() + 7 * 86_400_000) } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "invite.finder", entityType: "TeamInvite", entityId: i.id, after: { teamId: me.teamId, postId: post.id } });
    await notify(tx, [{ userId: post.userId, eventId: event.id, category: "team", title: `${access.actor!.name} invited you to join ${me.team.name}`, body: event.name, url: `/join/${token}` }]);
  });
  res.status(201).json({ invited: true });
});
