// Team formation: create a team, invite by link, join, leave, remove members.
// All of it is allowed from registration opening until submissions close.
import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { accessFor, decideParticipate, enforce, registrationWindow } from "../policy";
import { appendAudit, fromRequest } from "../audit";
import { eventBySlug } from "../lib/events";
import { HttpError, forbidden, notFound, unauthenticated } from "../lib/http";
import { randomToken, sha256 } from "../lib/crypto";
import { absoluteUrl, sendMail } from "../lib/mail";

export const teamsRouter = Router({ mergeParams: true });
export const invitesRouter = Router();

const HOUR = 3_600_000;
const TeamName = z.string().trim().min(1).max(80);

/** Lock the team row for the rest of the transaction, so size checks can't race. */
async function lockTeam(tx: Prisma.TransactionClient, teamId: string) {
  await tx.$queryRaw`SELECT id FROM "Team" WHERE id = ${teamId}::uuid FOR UPDATE`;
}

async function myMembership(eventId: string, userId: string) {
  return prisma.teamMember.findUnique({ where: { eventId_userId: { eventId, userId } } });
}

async function openEventFor(req: import("express").Request) {
  const event = await eventBySlug((req.params as { slug?: string }).slug);
  const access = await accessFor(req.actor, event.id);
  enforce(decideParticipate(access, registrationWindow(event)));
  return { event, actor: access.actor!, access };
}

/** The caller's team in this event, with members, active invites and projects. */
teamsRouter.get("/mine", async (req, res) => {
  const event = await eventBySlug((req.params as { slug?: string }).slug);
  if (!req.actor) throw unauthenticated();
  const access = await accessFor(req.actor, event.id);
  const membership = await myMembership(event.id, req.actor.id);
  if (!membership) {
    res.json({ registered: access.roles.has("participant"), team: null });
    return;
  }
  const team = await prisma.team.findUniqueOrThrow({
    where: { id: membership.teamId },
    select: {
      id: true, name: true,
      members: { orderBy: { joinedAt: "asc" }, select: { role: true, joinedAt: true, user: { select: { id: true, name: true, email: true } } } },
      invites: {
        where: { revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
        select: { id: true, expiresAt: true, uses: true, maxUses: true, createdAt: true },
      },
      projects: {
        where: { duplicateOfId: null, status: { not: "withdrawn" } },
        select: { id: true, title: true, status: true, submittedAt: true, updatedAt: true },
      },
    },
  });
  res.json({
    registered: true,
    myRole: membership.role,
    maxTeamSize: event.maxTeamSize,
    team: {
      ...team,
      members: team.members.map((m) => ({ ...m.user, role: m.role, joinedAt: m.joinedAt })),
      invites: team.invites.filter((i) => i.uses < i.maxUses),
    },
  });
});

teamsRouter.post("/", async (req, res) => {
  const { event, actor } = await openEventFor(req);
  const { name } = z.object({ name: TeamName }).parse(req.body);
  if (await myMembership(event.id, actor.id)) throw new HttpError(409, "already_on_team", "You are already on a team in this event.");

  const team = await prisma.$transaction(async (tx) => {
    await tx.eventRole.upsert({
      where: { eventId_userId_role: { eventId: event.id, userId: actor.id, role: "participant" } },
      update: {},
      create: { eventId: event.id, userId: actor.id, role: "participant" },
    });
    const t = await tx.team.create({ data: { eventId: event.id, name, createdById: actor.id } });
    await tx.teamMember.create({ data: { teamId: t.id, eventId: event.id, userId: actor.id, role: "captain" } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "team.create", entityType: "Team", entityId: t.id, after: { name } });
    return t;
  });
  res.status(201).json({ team: { id: team.id, name: team.name } });
});

teamsRouter.patch("/mine", async (req, res) => {
  const { event, actor } = await openEventFor(req);
  const { name } = z.object({ name: TeamName }).parse(req.body);
  const m = await myMembership(event.id, actor.id);
  if (!m) throw notFound("Team");
  if (m.role !== "captain") throw forbidden("Only the team captain can rename the team.");
  await prisma.$transaction(async (tx) => {
    const before = await tx.team.findUniqueOrThrow({ where: { id: m.teamId }, select: { name: true } });
    await tx.team.update({ where: { id: m.teamId }, data: { name } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "team.rename", entityType: "Team", entityId: m.teamId, before, after: { name } });
  });
  res.json({ team: { id: m.teamId, name } });
});

const InviteBody = z.object({
  maxUses: z.number().int().min(1).max(50).default(10),
  expiresInHours: z.number().int().min(1).max(24 * 30).default(72),
});

/** Any member can create an invite link. The token is shown once; only its hash is stored. */
teamsRouter.post("/mine/invites", async (req, res) => {
  const { event, actor } = await openEventFor(req);
  const body = InviteBody.parse(req.body ?? {});
  const m = await myMembership(event.id, actor.id);
  if (!m) throw notFound("Team");
  const token = randomToken(24);
  const invite = await prisma.$transaction(async (tx) => {
    const i = await tx.teamInvite.create({
      data: { teamId: m.teamId, tokenHash: sha256(token), createdById: actor.id, maxUses: body.maxUses, expiresAt: new Date(Date.now() + body.expiresInHours * HOUR) },
    });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "invite.create", entityType: "TeamInvite", entityId: i.id, after: { teamId: m.teamId, maxUses: i.maxUses, expiresAt: i.expiresAt } });
    return i;
  });
  res.status(201).json({ invite: { id: invite.id, expiresAt: invite.expiresAt, maxUses: invite.maxUses, token, joinPath: `/join/${token}` } });
});

/** Email a single-use invite link to one person. */
teamsRouter.post("/mine/invites/email", async (req, res) => {
  const { event, actor } = await openEventFor(req);
  const { email } = z.object({ email: z.email().transform((e) => e.trim().toLowerCase()) }).parse(req.body);
  const m = await myMembership(event.id, actor.id);
  if (!m) throw notFound("Team");
  const team = await prisma.team.findUniqueOrThrow({ where: { id: m.teamId }, include: { _count: { select: { members: true } } } });
  if (team._count.members >= event.maxTeamSize) throw new HttpError(409, "team_full", "Your team is already full.");
  const recent = await prisma.teamInvite.count({ where: { teamId: m.teamId, createdAt: { gt: new Date(Date.now() - HOUR) } } });
  if (recent >= 30) throw new HttpError(429, "too_many_invites", "Too many invites in the last hour.");

  const token = randomToken(24);
  const invite = await prisma.$transaction(async (tx) => {
    const i = await tx.teamInvite.create({
      data: { teamId: m.teamId, tokenHash: sha256(token), createdById: actor.id, maxUses: 1, expiresAt: new Date(Date.now() + 7 * 24 * HOUR) },
    });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "invite.email", entityType: "TeamInvite", entityId: i.id, after: { teamId: m.teamId, to: email } });
    return i;
  });
  const sent = await sendMail({
    to: email,
    subject: `${actor.name} invited you to join ${team.name} at ${event.name}`,
    heading: `Join ${team.name} at ${event.name}`,
    body: [`${actor.name} (${actor.email}) invited you to their team.`, "The link works once and expires in 7 days. You'll need to log in or create an account with any email."],
    action: { label: "Join the team", url: absoluteUrl(`/join/${token}`) },
  });
  res.status(201).json({ invite: { id: invite.id, expiresAt: invite.expiresAt }, sent });
});

teamsRouter.delete("/mine/invites/:inviteId", async (req, res) => {
  const event = await eventBySlug((req.params as { slug?: string }).slug);
  if (!req.actor) throw unauthenticated();
  const m = await myMembership(event.id, req.actor.id);
  const invite = m && (await prisma.teamInvite.findFirst({ where: { id: (req.params as { inviteId: string }).inviteId, teamId: m.teamId } }));
  if (!invite) throw notFound("Invite");
  await prisma.$transaction(async (tx) => {
    await tx.teamInvite.update({ where: { id: invite.id }, data: { revokedAt: new Date() } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "invite.revoke", entityType: "TeamInvite", entityId: invite.id });
  });
  res.status(204).end();
});

/**
 * Leave the team. A departing captain hands the captaincy to the longest-standing member.
 * The last member can only leave (and the team is removed) if it has no submitted project.
 */
teamsRouter.post("/mine/leave", async (req, res) => {
  const { event, actor } = await openEventFor(req);
  const m = await myMembership(event.id, actor.id);
  if (!m) throw notFound("Team");
  await prisma.$transaction(async (tx) => {
    await lockTeam(tx, m.teamId);
    const others = await tx.teamMember.findMany({ where: { teamId: m.teamId, userId: { not: actor.id } }, orderBy: { joinedAt: "asc" } });
    if (others.length === 0) {
      const submitted = await tx.project.count({ where: { teamId: m.teamId, status: "submitted" } });
      if (submitted > 0) throw new HttpError(409, "team_has_submission", "You are the last member of a team with a submitted project. Withdraw it first.");
      await tx.teamMember.delete({ where: { teamId_userId: { teamId: m.teamId, userId: actor.id } } });
      await tx.team.delete({ where: { id: m.teamId } });
      await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "team.disband", entityType: "Team", entityId: m.teamId });
      return;
    }
    await tx.teamMember.delete({ where: { teamId_userId: { teamId: m.teamId, userId: actor.id } } });
    if (m.role === "captain") {
      await tx.teamMember.update({ where: { teamId_userId: { teamId: m.teamId, userId: others[0]!.userId } }, data: { role: "captain" } });
    }
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "team.leave", entityType: "Team", entityId: m.teamId, after: { userId: actor.id, newCaptain: m.role === "captain" ? others[0]!.userId : null } });
  });
  res.status(204).end();
});

teamsRouter.delete("/mine/members/:userId", async (req, res) => {
  const { event, actor } = await openEventFor(req);
  const targetId = (req.params as { userId: string }).userId;
  const m = await myMembership(event.id, actor.id);
  if (!m) throw notFound("Team");
  if (m.role !== "captain") throw forbidden("Only the team captain can remove members.");
  if (targetId === actor.id) throw new HttpError(400, "use_leave", "Use leave to remove yourself.");
  const target = await prisma.teamMember.findUnique({ where: { teamId_userId: { teamId: m.teamId, userId: targetId } } });
  if (!target) throw notFound("Member");
  await prisma.$transaction(async (tx) => {
    await tx.teamMember.delete({ where: { teamId_userId: { teamId: m.teamId, userId: targetId } } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "team.remove_member", entityType: "Team", entityId: m.teamId, after: { userId: targetId } });
  });
  res.status(204).end();
});

// ── invite links (/api/invites/:token) ──────────────────────────────────────

type InviteStatus = "valid" | "expired" | "revoked" | "used_up" | "team_full" | "registration_closed" | "registration_not_open";

async function loadInvite(token: string) {
  const invite = await prisma.teamInvite.findUnique({
    where: { tokenHash: sha256(token) },
    include: { team: { include: { event: true, _count: { select: { members: true } } } } },
  });
  if (!invite) throw notFound("Invite");
  const { team } = invite;
  const window = registrationWindow(team.event);
  const now = new Date();
  const status: InviteStatus =
    invite.revokedAt ? "revoked"
    : invite.expiresAt <= now ? "expired"
    : invite.uses >= invite.maxUses ? "used_up"
    : window === "closed" ? "registration_closed"
    : window === "not_open" ? "registration_not_open"
    : team._count.members >= team.event.maxTeamSize ? "team_full"
    : "valid";
  return { invite, team, event: team.event, status };
}

/** Public preview so the join page can say which team the link is for. */
invitesRouter.get("/:token", async (req, res) => {
  const { team, event, status } = await loadInvite(req.params.token);
  res.json({
    status,
    team: { name: team.name, memberCount: team._count.members },
    event: { slug: event.slug, name: event.name, maxTeamSize: event.maxTeamSize },
  });
});

invitesRouter.post("/:token/accept", async (req, res) => {
  const { invite, team, event, status } = await loadInvite(req.params.token);
  const access = await accessFor(req.actor, event.id);
  enforce(decideParticipate(access, registrationWindow(event)));
  const actor = access.actor!;

  // Already on this team: opening the link again is harmless, even once the team is full.
  const existing = await myMembership(event.id, actor.id);
  if (existing?.teamId === team.id) {
    res.json({ team: { id: team.id, name: team.name }, alreadyMember: true });
    return;
  }
  if (status !== "valid") throw new HttpError(409, `invite_${status}`, `This invite can't be used (${status.replace(/_/g, " ")}).`);
  if (existing) throw new HttpError(409, "already_on_team", "You are already on another team in this event. Leave it first.");

  await prisma.$transaction(async (tx) => {
    await lockTeam(tx, team.id);
    // Re-check under the lock: two people racing for the last seat can't both get in.
    const [members, fresh] = await Promise.all([
      tx.teamMember.count({ where: { teamId: team.id } }),
      tx.teamInvite.findUniqueOrThrow({ where: { id: invite.id } }),
    ]);
    if (members >= event.maxTeamSize) throw new HttpError(409, "invite_team_full", "This team is full.");
    if (fresh.uses >= fresh.maxUses || fresh.revokedAt) throw new HttpError(409, "invite_used_up", "This invite has been used up.");
    await tx.eventRole.upsert({
      where: { eventId_userId_role: { eventId: event.id, userId: actor.id, role: "participant" } },
      update: {},
      create: { eventId: event.id, userId: actor.id, role: "participant" },
    });
    await tx.teamMember.create({ data: { teamId: team.id, eventId: event.id, userId: actor.id, role: "member" } });
    await tx.teamInvite.update({ where: { id: invite.id }, data: { uses: { increment: 1 } } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "team.join", entityType: "Team", entityId: team.id, after: { userId: actor.id, inviteId: invite.id } });
  });
  res.status(201).json({ team: { id: team.id, name: team.name } });
});
