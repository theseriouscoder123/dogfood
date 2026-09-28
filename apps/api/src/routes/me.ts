// The signed-in person's own things: dashboard, profile, password and sessions. Mounted at /api/me.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { HttpError, unauthenticated } from "../lib/http";
import { optionalImage, optionalUrl } from "../lib/validation";
import { audit, fromRequest } from "../audit";
import { hashPassword, verifyPassword } from "../auth/password";
import { requireBrowserSession, tokenFrom } from "../auth/session";
import { sha256 } from "../lib/crypto";
import { ensureHandle, HANDLE, RESERVED_HANDLES } from "../users/profile";
import { reviewTarget } from "./progress";
import { CATEGORIES } from "../notifications/notify";

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

// ── profile ─────────────────────────────────────────────────────────────────

const PROFILE = { id: true, email: true, name: true, handle: true, headline: true, bio: true, avatarUrl: true, location: true, website: true, githubUrl: true, linkedinUrl: true, skills: true, passwordHash: true, createdAt: true } as const;

const hostUrl = (hosts: string[]) =>
  optionalUrl.refine((u) => u === null || hosts.some((h) => new URL(u).hostname === h || new URL(u).hostname.endsWith(`.${h}`)), `Use a ${hosts[0]} link`);

export const ProfileBody = z.object({
  name: z.string().trim().min(1).max(100),
  handle: z
    .string()
    .trim()
    .toLowerCase()
    .regex(HANDLE, "3–30 lower-case letters, digits or dashes")
    .refine((h) => !RESERVED_HANDLES.has(h), "That handle is reserved"),
  headline: z.string().trim().max(120),
  bio: z.string().trim().max(2000),
  avatarUrl: optionalImage,
  location: z.string().trim().max(80),
  website: optionalUrl,
  githubUrl: hostUrl(["github.com"]),
  linkedinUrl: hostUrl(["linkedin.com"]),
  skills: z.array(z.string().trim().min(1).max(30)).max(20).transform((s) => [...new Set(s)]),
}).partial();

meRouter.get("/profile", async (req, res) => {
  if (!req.actor) throw unauthenticated();
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.actor.id }, select: PROFILE });
  const { passwordHash, ...profile } = u;
  res.json({ profile: { ...profile, handle: await ensureHandle(u), hasPassword: passwordHash !== null } });
});

meRouter.patch("/profile", async (req, res) => {
  if (!req.actor) throw unauthenticated();
  const body = ProfileBody.parse(req.body);
  if (body.handle) {
    const other = await prisma.user.findUnique({ where: { handle: body.handle }, select: { id: true } });
    if (other && other.id !== req.actor.id) throw new HttpError(409, "handle_taken", "That handle is taken.");
  }
  const u = await prisma.user.update({ where: { id: req.actor.id }, data: body, select: PROFILE });
  const { passwordHash: _p, ...profile } = u;
  res.json({ profile: { ...profile, hasPassword: _p !== null } });
});

// ── password and sessions ───────────────────────────────────────────────────

export const PasswordBody = z.object({ current: z.string().max(200).optional(), next: z.string().min(8, "At least 8 characters").max(200) });

/** Change (or, for link-only accounts, set) the password. Every other session is signed out. */
meRouter.post("/password", async (req, res) => {
  requireBrowserSession(req);
  if (!req.actor) throw unauthenticated();
  const { current, next } = PasswordBody.parse(req.body);
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.actor.id }, select: { passwordHash: true } });
  if (u.passwordHash && !(await verifyPassword(current ?? "", u.passwordHash))) throw new HttpError(400, "wrong_password", "Your current password isn't right.");
  const keep = sha256(tokenFrom(req.cookies, req.headers.authorization) ?? "");
  await prisma.$transaction([
    prisma.user.update({ where: { id: req.actor.id }, data: { passwordHash: await hashPassword(next) } }),
    prisma.session.deleteMany({ where: { userId: req.actor.id, tokenHash: { not: keep }, seeded: false } }),
  ]);
  await audit({ ...fromRequest(req), action: "auth.password_changed", entityType: "User", entityId: req.actor.id });
  res.json({ ok: true });
});

meRouter.get("/sessions", async (req, res) => {
  requireBrowserSession(req);
  if (!req.actor) throw unauthenticated();
  const keep = sha256(tokenFrom(req.cookies, req.headers.authorization) ?? "");
  const sessions = await prisma.session.findMany({ where: { userId: req.actor.id, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" }, select: { tokenHash: true, createdAt: true, expiresAt: true } });
  res.json({ sessions: sessions.map((s) => ({ current: s.tokenHash === keep, createdAt: s.createdAt, expiresAt: s.expiresAt })) });
});

meRouter.post("/sessions/revoke-others", async (req, res) => {
  requireBrowserSession(req);
  if (!req.actor) throw unauthenticated();
  const keep = sha256(tokenFrom(req.cookies, req.headers.authorization) ?? "");
  const { count } = await prisma.session.deleteMany({ where: { userId: req.actor.id, tokenHash: { not: keep }, seeded: false } });
  await audit({ ...fromRequest(req), action: "auth.sessions_revoked", entityType: "User", entityId: req.actor.id, after: { count } });
  res.json({ signedOut: count });
});

// ── notifications ───────────────────────────────────────────────────────────

export const NotificationsQuery = z.object({ before: z.iso.datetime().optional(), unread: z.enum(["true", "false"]).optional() });

meRouter.get("/notifications", async (req, res) => {
  if (!req.actor) throw unauthenticated();
  const { before, unread } = NotificationsQuery.parse(req.query);
  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: req.actor.id, ...(before ? { createdAt: { lt: new Date(before) } } : {}), ...(unread === "true" ? { readAt: null } : {}) },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, category: true, title: true, body: true, url: true, readAt: true, createdAt: true, eventId: true },
    }),
    prisma.notification.count({ where: { userId: req.actor.id, readAt: null } }),
  ]);
  res.json({ notifications: items, unread: unreadCount });
});

export const MarkReadBody = z.object({ ids: z.array(z.uuid()).max(200).optional(), all: z.boolean().optional() });

meRouter.post("/notifications/read", async (req, res) => {
  if (!req.actor) throw unauthenticated();
  const { ids, all } = MarkReadBody.parse(req.body);
  if (!all && !ids?.length) throw new HttpError(400, "nothing_to_mark", "Send ids, or all: true.");
  const r = await prisma.notification.updateMany({ where: { userId: req.actor.id, readAt: null, ...(all ? {} : { id: { in: ids } }) }, data: { readAt: new Date() } });
  res.json({ marked: r.count });
});

export const NotificationSettingsBody = z.object({
  email: z.boolean(),
  muted: z.array(z.enum(Object.keys(CATEGORIES) as [string, ...string[]])).max(20),
});

meRouter.get("/notification-settings", async (req, res) => {
  if (!req.actor) throw unauthenticated();
  const u = await prisma.user.findUniqueOrThrow({ where: { id: req.actor.id }, select: { emailNotifications: true, mutedNotifications: true } });
  res.json({ email: u.emailNotifications, muted: u.mutedNotifications, categories: CATEGORIES });
});

meRouter.put("/notification-settings", async (req, res) => {
  if (!req.actor) throw unauthenticated();
  const b = NotificationSettingsBody.parse(req.body);
  const u = await prisma.user.update({ where: { id: req.actor.id }, data: { emailNotifications: b.email, mutedNotifications: [...new Set(b.muted)] }, select: { emailNotifications: true, mutedNotifications: true } });
  res.json({ email: u.emailNotifications, muted: u.mutedNotifications, categories: CATEGORIES });
});
