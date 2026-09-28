// In-app notifications (and, for people who want them, email).
//
// Most are derived from the audit log inside the same transaction as the change, exactly like
// webhooks: nobody hears about something that rolled back. Deadline reminders are scheduled by the
// worker; a unique key per (reminder, event, person) means each goes out once, however often the
// worker runs.
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { absoluteUrl, sendMail } from "../lib/mail";

type Tx = Prisma.TransactionClient;

export const CATEGORIES = {
  announcements: "Announcements from organizers",
  team: "Team activity",
  submissions: "Your submissions",
  judging: "Judging",
  results: "Results and certificates",
  comments: "Comments and replies",
  organizer: "Organizer alerts",
  reminders: "Deadline reminders",
} as const;
export type Category = keyof typeof CATEGORIES;

/** Categories that also go out by email (to people with email notifications on). */
const EMAILED: ReadonlySet<Category> = new Set(["announcements", "results", "reminders", "organizer", "judging"]);

export type Note = { userId: string; eventId?: string | null; category: Category; title: string; body?: string; url: string; key?: string };

/** Write notifications, skipping anyone who muted the category (and never notifying people about their own actions). */
export async function notify(db: Tx | typeof prisma, notes: Note[], actorId?: string | null): Promise<number> {
  const wanted = notes.filter((n) => n.userId !== actorId);
  if (wanted.length === 0) return 0;
  const prefs = await db.user.findMany({ where: { id: { in: [...new Set(wanted.map((n) => n.userId))] } }, select: { id: true, mutedNotifications: true, emailNotifications: true } });
  const pref = new Map(prefs.map((p) => [p.id, p]));
  const rows = wanted
    .filter((n) => pref.has(n.userId) && !pref.get(n.userId)!.mutedNotifications.includes(n.category))
    .map((n) => ({
      userId: n.userId,
      eventId: n.eventId ?? null,
      category: n.category,
      title: n.title,
      body: n.body ?? "",
      url: n.url,
      key: n.key ?? null,
      emailWanted: EMAILED.has(n.category) && pref.get(n.userId)!.emailNotifications,
    }));
  const r = await db.notification.createMany({ data: rows, skipDuplicates: true });
  return r.count;
}

type Facts = { eventId: string | null; action: string; entityId: string | null; actorUserId: string | null; after: unknown };
const get = (a: unknown, k: string) => (a && typeof a === "object" ? (a as Record<string, unknown>)[k] : undefined);

/** Called by appendAudit for every audited change. */
export async function notifyForAudit(tx: Tx, f: Facts): Promise<void> {
  if (!f.eventId) return;
  const handler = HANDLERS[f.action];
  if (!handler) return;
  const event = await tx.event.findUniqueOrThrow({ where: { id: f.eventId }, select: { id: true, slug: true, name: true } });
  const notes = await handler(tx, f, event);
  if (notes.length) await notify(tx, notes.map((n) => ({ eventId: event.id, ...n })), f.actorUserId);
}

type Ev = { id: string; slug: string; name: string };
type Handler = (tx: Tx, f: Facts, e: Ev) => Promise<Note[]>;

const teamMembers = (tx: Tx, teamId: string) => tx.teamMember.findMany({ where: { teamId }, select: { userId: true } });
const nameOf = async (tx: Tx, userId: unknown) => (typeof userId === "string" ? ((await tx.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? "Someone") : "Someone");
const roleHolders = (tx: Tx, eventId: string, roles: Array<"participant" | "judge" | "organizer">) =>
  tx.eventRole.findMany({ where: { eventId, role: { in: roles } }, select: { userId: true }, distinct: ["userId"] });

const HANDLERS: Record<string, Handler> = {
  "team.join": async (tx, f, e) => {
    if (!f.entityId) return [];
    const [team, name, members] = await Promise.all([tx.team.findUnique({ where: { id: f.entityId }, select: { name: true } }), nameOf(tx, get(f.after, "userId")), teamMembers(tx, f.entityId)]);
    return members.map((m) => ({ userId: m.userId, category: "team", title: `${name} joined ${team?.name ?? "your team"}`, url: `/events/${e.slug}/team` }));
  },
  "team.leave": async (tx, f, e) => {
    if (!f.entityId) return [];
    const [name, members] = await Promise.all([nameOf(tx, get(f.after, "userId")), teamMembers(tx, f.entityId)]);
    return members.map((m) => ({ userId: m.userId, category: "team", title: `${name} left your team`, body: e.name, url: `/events/${e.slug}/team` }));
  },
  "team.remove_member": async (_tx, f, e) => {
    const uid = get(f.after, "userId");
    return typeof uid === "string" ? [{ userId: uid, category: "team", title: `You were removed from a team in ${e.name}`, url: `/events/${e.slug}` }] : [];
  },
  "project.submit": async (tx, f, e) => {
    const p = f.entityId ? await tx.project.findUnique({ where: { id: f.entityId }, select: { title: true, teamId: true } }) : null;
    if (!p) return [];
    return (await teamMembers(tx, p.teamId)).map((m) => ({ userId: m.userId, category: "submissions", title: `“${p.title}” is submitted`, body: `You can keep editing until submissions close.`, url: `/events/${e.slug}/projects/${f.entityId}` }));
  },
  "judge.invite": async (_tx, f, e) => (f.entityId ? [{ userId: f.entityId, category: "judging", title: `You're on the judging panel for ${e.name}`, url: `/events/${e.slug}/judging` }] : []),
  "assignments.batch_committed": async (tx, f, e) => {
    if (!f.entityId) return [];
    const per = await tx.assignment.groupBy({ by: ["judgeId"], where: { batchId: f.entityId }, _count: { _all: true } });
    return per.map((j) => ({ userId: j.judgeId, category: "judging", title: `${j._count._all} project${j._count._all === 1 ? "" : "s"} to review`, body: e.name, url: `/events/${e.slug}/judging` }));
  },
  "results.published": async (tx, _f, e) =>
    (await roleHolders(tx, e.id, ["participant", "judge"])).map((r) => ({ userId: r.userId, category: "results", title: `Results are out for ${e.name}`, url: `/events/${e.slug}/results`, key: `results:${e.id}:${r.userId}` })),
  "voting.results_published": async (tx, _f, e) =>
    (await roleHolders(tx, e.id, ["participant"])).map((r) => ({ userId: r.userId, category: "results", title: `People's Choice results are out`, body: e.name, url: `/events/${e.slug}/peoples-choice`, key: `pc:${e.id}:${r.userId}` })),
  "records.issued": async (tx, f, e) => {
    const at = get(f.after, "issuedAt");
    if (typeof at !== "string") return [];
    const recs = await tx.signedRecord.findMany({ where: { eventId: e.id, issuedAt: new Date(at) }, select: { id: true, userId: true, type: true } });
    return recs.map((r) => ({ userId: r.userId, category: "results", title: r.type === "judge_participation" ? `Your judging record for ${e.name} is ready` : `Your certificate for ${e.name} is ready`, url: `/certificates/${r.id}` }));
  },
  "comment.created": async (tx, f, e) => {
    const projectId = get(f.after, "projectId");
    const parentId = get(f.after, "parentId");
    if (typeof projectId !== "string") return [];
    const [project, author] = await Promise.all([tx.project.findUnique({ where: { id: projectId }, select: { title: true, teamId: true } }), nameOf(tx, f.actorUserId)]);
    if (!project) return [];
    const url = `/events/${e.slug}/projects/${projectId}#comment-${f.entityId}`;
    const notes: Note[] = (await teamMembers(tx, project.teamId)).map((m) => ({ userId: m.userId, category: "comments", title: `${author} commented on “${project.title}”`, url }));
    if (typeof parentId === "string") {
      const parent = await tx.comment.findUnique({ where: { id: parentId }, select: { authorId: true } });
      if (parent && !notes.some((n) => n.userId === parent.authorId)) notes.push({ userId: parent.authorId, category: "comments", title: `${author} replied to your comment`, body: project.title, url });
    }
    return notes;
  },
  "comment.hidden": async (tx, f, e) => {
    const c = f.entityId ? await tx.comment.findUnique({ where: { id: f.entityId }, select: { authorId: true, projectId: true } }) : null;
    return c ? [{ userId: c.authorId, category: "comments", title: "A moderator hid your comment", body: String(get(f.after, "reason") ?? ""), url: `/events/${e.slug}/projects/${c.projectId}` }] : [];
  },
  "webhook.disabled": async (tx, f, e) =>
    (await roleHolders(tx, e.id, ["organizer"])).map((r) => ({ userId: r.userId, category: "organizer", title: "A webhook was switched off", body: String(get(f.after, "reason") ?? ""), url: `/events/${e.slug}/manage/webhooks/${f.entityId}` })),
};

// ── scheduled: deadline reminders ───────────────────────────────────────────

const HOUR = 3_600_000;

/** Reminders 24 hours and 1 hour before submissions close (to teams without a submitted project), and 24 hours before judging closes (to judges with work left). */
export async function runReminders(now = new Date()): Promise<number> {
  let sent = 0;
  const soon = await prisma.event.findMany({
    where: { publishedAt: { not: null }, submissionsCloseAt: { gt: now, lte: new Date(now.getTime() + 24 * HOUR) } },
    select: { id: true, slug: true, name: true, submissionsCloseAt: true },
  });
  for (const e of soon) {
    const hourLeft = e.submissionsCloseAt.getTime() - now.getTime() <= HOUR;
    const people = await prisma.eventRole.findMany({
      where: { eventId: e.id, role: "participant", user: { memberships: { none: { eventId: e.id, team: { projects: { some: { status: "submitted" } } } } } } },
      select: { userId: true },
    });
    sent += await notify(
      prisma,
      people.map((p) => ({
        userId: p.userId,
        eventId: e.id,
        category: "reminders" as const,
        title: hourLeft ? `One hour left to submit to ${e.name}` : `Submissions for ${e.name} close in 24 hours`,
        body: "Your team hasn't submitted a project yet.",
        url: `/events/${e.slug}/team`,
        key: `${hourLeft ? "sub1h" : "sub24h"}:${e.id}:${p.userId}`,
      })),
    );
  }
  const judging = await prisma.event.findMany({
    where: { publishedAt: { not: null }, judgingClosesAt: { gt: now, lte: new Date(now.getTime() + 24 * HOUR) } },
    select: { id: true, slug: true, name: true },
  });
  for (const e of judging) {
    const left = await prisma.assignment.groupBy({ by: ["judgeId"], where: { eventId: e.id, status: { in: ["assigned", "in_progress"] } }, _count: { _all: true } });
    sent += await notify(
      prisma,
      left.map((j) => ({
        userId: j.judgeId,
        eventId: e.id,
        category: "reminders" as const,
        title: `Judging for ${e.name} closes in 24 hours`,
        body: `${j._count._all} review${j._count._all === 1 ? "" : "s"} left.`,
        url: `/events/${e.slug}/judging`,
        key: `judge24h:${e.id}:${j.judgeId}`,
      })),
    );
  }
  return sent;
}

/** Email the notifications that asked for it. At most a batch per call; the worker keeps calling. */
export async function sendNotificationEmails(limit = 20): Promise<number> {
  const due = await prisma.notification.findMany({ where: { emailWanted: true, emailedAt: null }, orderBy: { createdAt: "asc" }, take: limit, include: { user: { select: { email: true } } } });
  for (const n of due) {
    // Marked first: a failed send is logged by sendMail and not retried, so nobody gets duplicates.
    await prisma.notification.update({ where: { id: n.id }, data: { emailedAt: new Date() } });
    await sendMail({ to: n.user.email, subject: n.title, heading: n.title, body: [n.body].filter(Boolean), action: { label: "Open Dogfood", url: absoluteUrl(n.url) } });
  }
  return due.length;
}
