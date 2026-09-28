// Project comments (T3).
//
// Public, mounted at /api/events/:slug/projects/:projectId/comments:
//   GET    /                     threads for a public project, with what the viewer may do
//   POST   /                     post (or reply to a top-level comment)
//   PATCH  /:commentId           edit your own, within 15 minutes
//   DELETE /:commentId           delete your own
//   POST   /:commentId/report    report someone else's (once); 3 reports hide it pending review
//
// Moderation, mounted at /api/events/:slug (organizers):
//   GET  /comments/moderation            reported, hidden and recent comments
//   PUT  /comments/settings              open / read-only / off
//   POST /comments/:commentId/hide       with a reason (reversible)
//   POST /comments/:commentId/unhide
//   POST /comments/:commentId/dismiss    the reports were wrong; clears them (and an automatic hide)
//
// Comments are plain text: the API returns exactly what was typed and the page renders it as
// text, so there is no HTML to sanitize and nothing to inject.
import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { accessFor, decideComment, decideOrganize, decideViewProject, enforce, judgingWindow, type Outcome } from "../policy";
import { appendAudit, fromRequest } from "../audit";
import { eventBySlug } from "../lib/events";
import { requireBrowserSession } from "../auth/session";
import { HttpError, notFound, unauthenticated } from "../lib/http";
import { projectContext } from "./projects";
import {
  AUTO_HIDE_REPORTS, BURST, containsLink, DAILY, fingerprintBody, LINKS_MIN_ACCOUNT_AGE_MS, MAX_LENGTH, TRUSTED_REPORTER_AGE_MS, withinEditWindow,
} from "../comments/rules";

export const commentsRouter = Router({ mergeParams: true });
export const commentModerationRouter = Router({ mergeParams: true });

const Body = z.string().trim().min(1, "Write something first.").max(MAX_LENGTH, `Keep it under ${MAX_LENGTH} characters.`);

/** Comments live on public projects only: submitted and not a duplicate. */
async function publicProject(req: Request) {
  const ctx = await projectContext(req);
  if (decideViewProject(ctx.access, ctx.project, ctx.isTeamMember) !== "allow") throw notFound("Project");
  if (ctx.project.status !== "submitted" || ctx.project.duplicateOfId) throw new HttpError(409, "not_public", "Comments open once the project is submitted.");
  return ctx;
}

type Row = Awaited<ReturnType<typeof loadRows>>[number];
async function loadRows(projectId: string) {
  return prisma.comment.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, parentId: true, body: true, createdAt: true, editedAt: true, deletedAt: true, hiddenAt: true, authorId: true,
      author: { select: { id: true, name: true, handle: true, avatarUrl: true } },
    },
  });
}

commentsRouter.get("/", async (req, res) => {
  const { event, project, access } = await publicProject(req);
  const mode = event.commentsMode;
  if (mode === "off") {
    res.json({ mode, canComment: false, reason: "comments_off", count: 0, threads: [] });
    return;
  }
  const [rows, team, organizers, myReports] = await Promise.all([
    loadRows(project.id),
    prisma.teamMember.findMany({ where: { teamId: project.teamId }, select: { userId: true } }),
    prisma.eventRole.findMany({ where: { eventId: event.id, role: "organizer" }, select: { userId: true } }),
    access.actor ? prisma.commentReport.findMany({ where: { reporterId: access.actor.id, comment: { projectId: project.id } }, select: { commentId: true } }) : [],
  ]);
  const teamIds = new Set(team.map((t) => t.userId));
  const organizerIds = new Set(organizers.map((o) => o.userId));
  const reported = new Set(myReports.map((r) => r.commentId));
  const me = access.actor?.id ?? null;
  const decision: Outcome = decideComment(access, mode, judgingWindow(event));

  const shape = (c: Row) => {
    const state = c.deletedAt ? "deleted" : c.hiddenAt ? "hidden" : "visible";
    const visible = state === "visible";
    const mine = me !== null && c.authorId === me;
    return {
      id: c.id,
      state,
      body: visible ? c.body : null,
      author: visible
        ? { name: c.author.name, profile: c.author.handle ?? c.author.id, avatarUrl: c.author.avatarUrl, badges: [...(teamIds.has(c.authorId) ? ["team"] : []), ...(organizerIds.has(c.authorId) ? ["organizer"] : [])] }
        : null,
      createdAt: c.createdAt,
      editedAt: visible ? c.editedAt : null,
      mine: mine && visible,
      canEdit: mine && visible && decision === "allow" && withinEditWindow(c.createdAt),
      canDelete: mine && !c.deletedAt,
      canReport: me !== null && !mine && visible && !reported.has(c.id),
      reportedByMe: reported.has(c.id),
    };
  };
  const top = rows.filter((c) => !c.parentId);
  const repliesOf = new Map<string, Row[]>();
  for (const c of rows) if (c.parentId) repliesOf.set(c.parentId, [...(repliesOf.get(c.parentId) ?? []), c]);
  const threads = top
    .map((c) => ({ ...shape(c), replies: (repliesOf.get(c.id) ?? []).filter((r) => !r.deletedAt && !r.hiddenAt).map(shape) }))
    // A removed comment stays as a placeholder only if replies hang off it.
    .filter((t) => t.state === "visible" || t.replies.length > 0)
    .reverse(); // newest conversations first; replies stay oldest-first

  res.json({
    mode,
    canComment: decision === "allow",
    reason: decision === "allow" ? null : decision,
    count: rows.filter((c) => !c.deletedAt && !c.hiddenAt).length,
    threads,
  });
});

/** Spam guards shared by posting and editing. */
async function guard(req: Request, authorId: string, body: string, exceptId?: string) {
  const author = await prisma.user.findUniqueOrThrow({ where: { id: authorId }, select: { createdAt: true } });
  if (containsLink(body) && Date.now() - author.createdAt.getTime() < LINKS_MIN_ACCOUNT_AGE_MS)
    throw new HttpError(422, "links_need_older_account", "New accounts can't post links for their first day. Describe it in words for now.");
  const since = (ms: number) => new Date(Date.now() - ms);
  if (!exceptId) {
    const [burst, daily] = await Promise.all([
      prisma.comment.count({ where: { authorId, createdAt: { gt: since(BURST.windowMs) } } }),
      prisma.comment.count({ where: { authorId, createdAt: { gt: since(DAILY.windowMs) } } }),
    ]);
    if (burst >= BURST.count) throw new HttpError(429, "slow_down", "You're commenting very fast. Wait a few minutes and try again.");
    if (daily >= DAILY.count) throw new HttpError(429, "daily_limit", "That's a lot of comments for one day. Try again tomorrow.");
  }
  const recent = await prisma.comment.findMany({ where: { authorId, createdAt: { gt: since(DAILY.windowMs) }, deletedAt: null, ...(exceptId ? { NOT: { id: exceptId } } : {}) }, select: { body: true } });
  const fp = fingerprintBody(body);
  if (fp && recent.some((r) => fingerprintBody(r.body) === fp)) throw new HttpError(409, "duplicate_comment", "You've already posted that comment. Say something new, or edit the first one.");
}

export const CreateCommentBody = z.object({ body: Body, parentId: z.uuid().nullable().optional() });

commentsRouter.post("/", async (req, res) => {
  requireBrowserSession(req);
  const { event, project, access } = await publicProject(req);
  enforce(decideComment(access, event.commentsMode, judgingWindow(event)));
  const input = CreateCommentBody.parse(req.body);
  if (input.parentId) {
    const parent = await prisma.comment.findFirst({ where: { id: input.parentId, projectId: project.id } });
    if (!parent) throw notFound("Comment");
    if (parent.parentId) throw new HttpError(400, "reply_depth", "Reply to the conversation's first comment; replies go one level deep.");
    if (parent.deletedAt || parent.hiddenAt) throw new HttpError(409, "parent_removed", "That comment was removed, so it can't take new replies.");
  }
  await guard(req, access.actor!.id, input.body);
  const comment = await prisma.$transaction(async (tx) => {
    const c = await tx.comment.create({ data: { eventId: event.id, projectId: project.id, authorId: access.actor!.id, parentId: input.parentId ?? null, body: input.body, ip: req.ip ?? null } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "comment.created", entityType: "Comment", entityId: c.id, after: { projectId: project.id, parentId: c.parentId, length: c.body.length } });
    return c;
  });
  res.status(201).json({ comment: { id: comment.id, body: comment.body, createdAt: comment.createdAt, parentId: comment.parentId } });
});

async function ownComment(req: Request, projectId: string) {
  if (!req.actor) throw unauthenticated();
  const id = (req.params as { commentId: string }).commentId;
  const c = z.uuid().safeParse(id).success ? await prisma.comment.findFirst({ where: { id, projectId } }) : null;
  if (!c) throw notFound("Comment");
  if (c.authorId !== req.actor.id) throw new HttpError(403, "not_yours", "You can only change your own comments.");
  return c;
}

export const EditCommentBody = z.object({ body: Body });

commentsRouter.patch("/:commentId", async (req, res) => {
  requireBrowserSession(req);
  const { event, project, access } = await publicProject(req);
  enforce(decideComment(access, event.commentsMode, judgingWindow(event)));
  const c = await ownComment(req, project.id);
  if (c.deletedAt || c.hiddenAt) throw new HttpError(409, "removed", "This comment was removed and can't be edited.");
  if (!withinEditWindow(c.createdAt)) throw new HttpError(409, "edit_window_closed", "Comments can be edited for 15 minutes after posting. Post a reply to add something.");
  const { body } = EditCommentBody.parse(req.body);
  await guard(req, c.authorId, body, c.id);
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.comment.update({ where: { id: c.id }, data: { body, editedAt: new Date() } });
    // The earlier text is kept in the audit log, so an edit can't quietly rewrite a conversation.
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "comment.edited", entityType: "Comment", entityId: c.id, before: { body: c.body }, after: { body } });
    return u;
  });
  res.json({ comment: { id: updated.id, body: updated.body, editedAt: updated.editedAt } });
});

commentsRouter.delete("/:commentId", async (req, res) => {
  const { event, project } = await publicProject(req);
  const c = await ownComment(req, project.id);
  if (!c.deletedAt)
    await prisma.$transaction(async (tx) => {
      await tx.comment.update({ where: { id: c.id }, data: { deletedAt: new Date() } });
      await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "comment.deleted", entityType: "Comment", entityId: c.id });
    });
  res.status(204).end();
});

export const ReportCommentBody = z.object({ reason: z.enum(["spam", "abuse", "off_topic", "other"]), note: z.string().trim().max(500).default("") });

commentsRouter.post("/:commentId/report", async (req, res) => {
  requireBrowserSession(req);
  const { event, project } = await publicProject(req);
  if (!req.actor) throw unauthenticated();
  const id = (req.params as { commentId: string }).commentId;
  const c = z.uuid().safeParse(id).success ? await prisma.comment.findFirst({ where: { id, projectId: project.id } }) : null;
  if (!c || c.deletedAt) throw notFound("Comment");
  if (c.authorId === req.actor.id) throw new HttpError(400, "own_comment", "You can't report your own comment. Delete it instead.");
  const body = ReportCommentBody.parse(req.body);
  const existing = await prisma.commentReport.findUnique({ where: { commentId_reporterId: { commentId: c.id, reporterId: req.actor.id } } });
  if (existing) throw new HttpError(409, "already_reported", "You've already reported this comment. The organizers will review it.");

  const autoHidden = await prisma.$transaction(async (tx) => {
    await tx.commentReport.create({ data: { commentId: c.id, reporterId: req.actor!.id, reason: body.reason, note: body.note } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "comment.reported", entityType: "Comment", entityId: c.id, after: { reason: body.reason } });
    if (c.hiddenAt) return false;
    // Reports from established accounts only, so a handful of throwaway accounts can't silence someone.
    const trusted = await tx.commentReport.count({
      where: { commentId: c.id, resolvedAt: null, reporter: { createdAt: { lt: new Date(Date.now() - TRUSTED_REPORTER_AGE_MS) } } },
    });
    if (trusted < AUTO_HIDE_REPORTS) return false;
    await tx.comment.update({ where: { id: c.id }, data: { hiddenAt: new Date(), hiddenById: null, hiddenReason: `Hidden automatically after ${trusted} reports, pending review` } });
    await appendAudit(tx, { ...fromRequest(req), actorLabel: "system:auto-moderation", eventId: event.id, action: "comment.auto_hidden", entityType: "Comment", entityId: c.id, after: { reports: trusted } });
    return true;
  });
  res.status(201).json({ reported: true, hidden: autoHidden });
});

// ── moderation ──────────────────────────────────────────────────────────────

async function staffEvent(req: Request) {
  const event = await eventBySlug((req.params as { slug?: string }).slug);
  enforce(decideOrganize(await accessFor(req.actor, event.id)));
  return event;
}

async function commentInEvent(eventId: string, req: Request) {
  const id = (req.params as { commentId: string }).commentId;
  const c = z.uuid().safeParse(id).success ? await prisma.comment.findFirst({ where: { id, eventId } }) : null;
  if (!c) throw notFound("Comment");
  return c;
}

export const ModerationQuery = z.object({ filter: z.enum(["reported", "hidden", "recent"]).catch("reported") });

commentModerationRouter.get("/comments/moderation", async (req, res) => {
  const event = await staffEvent(req);
  const filter = ModerationQuery.parse(req.query).filter;
  const where =
    filter === "reported"
      ? { eventId: event.id, deletedAt: null, reports: { some: { resolvedAt: null } } }
      : filter === "hidden"
        ? { eventId: event.id, hiddenAt: { not: null } }
        : { eventId: event.id };
  const [items, reported, hidden, total] = await Promise.all([
    prisma.comment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        author: { select: { name: true, email: true, createdAt: true } },
        project: { select: { id: true, title: true } },
        hiddenBy: { select: { name: true } },
        reports: { where: { resolvedAt: null }, orderBy: { createdAt: "asc" }, include: { reporter: { select: { name: true } } } },
        _count: { select: { reports: true } },
      },
    }),
    prisma.comment.count({ where: { eventId: event.id, deletedAt: null, reports: { some: { resolvedAt: null } } } }),
    prisma.comment.count({ where: { eventId: event.id, hiddenAt: { not: null } } }),
    prisma.comment.count({ where: { eventId: event.id } }),
  ]);
  res.json({
    mode: event.commentsMode,
    counts: { reported, hidden, total },
    items: items.map((c) => ({
      id: c.id,
      body: c.body,
      project: c.project,
      isReply: c.parentId !== null,
      author: { name: c.author.name, email: c.author.email, accountAgeDays: Math.floor((c.createdAt.getTime() - c.author.createdAt.getTime()) / 86_400_000) },
      createdAt: c.createdAt,
      editedAt: c.editedAt,
      deleted: c.deletedAt !== null,
      hidden: c.hiddenAt ? { at: c.hiddenAt, by: c.hiddenBy?.name ?? null, auto: c.hiddenById === null, reason: c.hiddenReason } : null,
      openReports: c.reports.map((r) => ({ reason: r.reason, note: r.note, at: r.createdAt, by: r.reporter.name })),
      totalReports: c._count.reports,
    })),
  });
});

export const CommentsSettingsBody = z.object({ mode: z.enum(["open", "read_only", "off"]) });

commentModerationRouter.put("/comments/settings", async (req, res) => {
  const event = await staffEvent(req);
  const { mode } = CommentsSettingsBody.parse(req.body);
  await prisma.$transaction(async (tx) => {
    await tx.event.update({ where: { id: event.id }, data: { commentsMode: mode } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "comments.settings_updated", entityType: "Event", entityId: event.id, before: { mode: event.commentsMode }, after: { mode } });
  });
  res.json({ mode });
});

export const HideCommentBody = z.object({ reason: z.string().trim().min(3, "Say why (at least 3 characters).").max(300) });

commentModerationRouter.post("/comments/:commentId/hide", async (req, res) => {
  const event = await staffEvent(req);
  const c = await commentInEvent(event.id, req);
  const { reason } = HideCommentBody.parse(req.body);
  await prisma.$transaction(async (tx) => {
    await tx.comment.update({ where: { id: c.id }, data: { hiddenAt: new Date(), hiddenById: req.actor!.id, hiddenReason: reason } });
    await tx.commentReport.updateMany({ where: { commentId: c.id, resolvedAt: null }, data: { resolvedAt: new Date() } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "comment.hidden", entityType: "Comment", entityId: c.id, after: { reason } });
  });
  res.json({ hidden: true });
});

commentModerationRouter.post("/comments/:commentId/unhide", async (req, res) => {
  const event = await staffEvent(req);
  const c = await commentInEvent(event.id, req);
  if (!c.hiddenAt) throw new HttpError(409, "not_hidden", "That comment isn't hidden.");
  await prisma.$transaction(async (tx) => {
    await tx.comment.update({ where: { id: c.id }, data: { hiddenAt: null, hiddenById: null, hiddenReason: null } });
    await tx.commentReport.updateMany({ where: { commentId: c.id, resolvedAt: null }, data: { resolvedAt: new Date() } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "comment.unhidden", entityType: "Comment", entityId: c.id, before: { reason: c.hiddenReason } });
  });
  res.json({ hidden: false });
});

commentModerationRouter.post("/comments/:commentId/dismiss", async (req, res) => {
  const event = await staffEvent(req);
  const c = await commentInEvent(event.id, req);
  const { note } = z.object({ note: z.string().trim().max(300).default("") }).parse(req.body ?? {});
  const autoHidden = c.hiddenAt !== null && c.hiddenById === null;
  await prisma.$transaction(async (tx) => {
    await tx.commentReport.updateMany({ where: { commentId: c.id, resolvedAt: null }, data: { resolvedAt: new Date() } });
    // Reports were wrong: undo the automatic hide too. A hide by an organizer stays until they undo it.
    if (autoHidden) await tx.comment.update({ where: { id: c.id }, data: { hiddenAt: null, hiddenReason: null } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "comment.reports_dismissed", entityType: "Comment", entityId: c.id, after: { note, restored: autoHidden } });
  });
  res.json({ dismissed: true, restored: autoHidden });
});
