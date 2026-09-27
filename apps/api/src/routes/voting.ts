// Community voting (T3). Mounted at /api/events/:slug.
//
// Organizer:
//   GET  /voting/admin            settings, turnout (never per-project numbers), invite batches
//   PUT  /voting/settings         window, how voters prove identity, votes per voter, allowed domains
//   POST /voting/invites          mint single-use ballot codes (shown once, stored hashed)
//   POST /voting/invites/revoke   revoke a batch's unused codes
// Voter:
//   GET  /vote                    my status, my ballot, projects in my own random order
//   POST /vote/redeem             exchange a ballot code for a voter identity (invite mode)
//   PUT  /ballot                  replace my picks (up to votesPerVoter), until voting closes
//
// While voting is open nobody can read a tally: not the public, not judges, not organizers.
// There is simply no endpoint that returns one until results are published (phase 4).
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { Event } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { accessFor, decideOrganize, decideVote, enforce, votingWindow, type VoterIdentity } from "../policy";
import { appendAudit, audit, fromRequest } from "../audit";
import { eventBySlug } from "../lib/events";
import { HttpError } from "../lib/http";
import { config } from "../config";
import { randomToken, sha256 } from "../lib/crypto";
import { ballotOrder, canonicalCode, emailDomainAllowed, makeInviteCode, makeReceipt, normalizeEmail } from "../voting/core";

export const votingRouter = Router({ mergeParams: true });

const DAY = 86_400_000;
const REDEEM_FAILURES_PER_IP_PER_HOUR = 20;

async function staffEvent(req: Request) {
  const event = await eventBySlug((req.params as { slug?: string }).slug);
  enforce(decideOrganize(await accessFor(req.actor, event.id)));
  return event;
}

const inviteCookie = (event: Event) => `dfv_${event.slug}`;

// ── who is voting ───────────────────────────────────────────────────────────

type Resolved = {
  identity: VoterIdentity;
  identityKey: string | null; // stable per person per event; seeds their ballot order
  emailKey: string | null;
  userId: string | null;
  inviteVoterId: string | null;
  email: string | null;
};

async function resolveVoter(req: Request, event: Event): Promise<Resolved> {
  if (event.votingMode === "invite") {
    const token = (req.cookies as Record<string, string> | undefined)?.[inviteCookie(event)];
    const voter = token ? await prisma.voter.findFirst({ where: { eventId: event.id, tokenHash: sha256(token), kind: "invite" } }) : null;
    return voter
      ? { identity: { kind: "invite" }, identityKey: voter.identityKey, emailKey: null, userId: null, inviteVoterId: voter.id, email: null }
      : { identity: { kind: "none" }, identityKey: null, emailKey: null, userId: null, inviteVoterId: null, email: null };
  }
  if (!req.actor) return { identity: { kind: "none" }, identityKey: null, emailKey: null, userId: null, inviteVoterId: null, email: null };
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.actor.id }, select: { id: true, email: true, emailVerifiedAt: true } });
  return {
    identity: { kind: "user", emailVerified: user.emailVerifiedAt !== null, domainAllowed: emailDomainAllowed(user.email, event.voterDomains) },
    identityKey: `user:${user.id}`,
    emailKey: normalizeEmail(user.email),
    userId: user.id,
    inviteVoterId: null,
    email: user.email,
  };
}

/** Submitted, non-duplicate projects: the only things on a ballot. */
async function ballotProjects(eventId: string) {
  return prisma.project.findMany({
    where: { eventId, status: "submitted", duplicateOfId: null },
    select: {
      id: true, title: true, tagline: true, thumbnailUrl: true, teamId: true,
      team: { select: { name: true, members: { select: { userId: true, user: { select: { name: true } } } } } },
      track: { select: { id: true, name: true } },
    },
  });
}

/** Another account on the same inbox (john+2@, j.ohn@gmail) already holds a ballot here. */
async function inboxTaken(eventId: string, r: Resolved) {
  if (!r.emailKey || !r.identityKey) return false;
  const other = await prisma.voter.findFirst({ where: { eventId, emailKey: r.emailKey, NOT: { identityKey: r.identityKey } }, select: { id: true } });
  return other !== null;
}

votingRouter.get("/vote", async (req, res) => {
  const event = await eventBySlug((req.params as { slug?: string }).slug);
  const window = votingWindow(event);
  if (window === "off") enforce("voting_off");
  const [access, r] = await Promise.all([accessFor(req.actor, event.id), resolveVoter(req, event)]);
  let status: string = decideVote(access, window === "closed" ? "open" : window, event.votingMode, r.identity);
  if (status === "allow" && (await inboxTaken(event.id, r))) status = "duplicate_inbox";

  const voter = r.identityKey ? await prisma.voter.findUnique({ where: { eventId_identityKey: { eventId: event.id, identityKey: r.identityKey } }, include: { ballot: { include: { choices: true } } } }) : null;
  const canSeeBallot = status === "allow";
  let projects: Array<Record<string, unknown>> = [];
  if (canSeeBallot && r.identityKey) {
    const all = await ballotProjects(event.id);
    const byId = new Map(all.map((p) => [p.id, p]));
    projects = ballotOrder(all.map((p) => p.id), `${event.id}:${r.identityKey}`).map((id, position) => {
      const p = byId.get(id)!;
      return {
        id: p.id, title: p.title, tagline: p.tagline, thumbnailUrl: p.thumbnailUrl, position,
        team: p.team.name, members: p.team.members.map((m) => m.user.name), track: p.track,
        ownTeam: r.userId !== null && p.team.members.some((m) => m.userId === r.userId),
      };
    });
  }
  res.json({
    event: { slug: event.slug, name: event.name },
    window: votingWindow(event),
    opensAt: event.votingOpensAt,
    closesAt: event.votingClosesAt,
    mode: event.votingMode,
    votesPerVoter: event.votesPerVoter,
    voterDomains: event.voterDomains,
    // "allow" (you can vote) or the reason you can't yet. While voting is closed, a voter still
    // sees their own ballot and receipt.
    status: window === "open" ? status : status === "allow" ? window : status,
    me: r.identity.kind === "none" ? null : { email: r.email, via: r.identity.kind === "invite" ? "invite" : event.votingMode },
    ballot: voter?.ballot ? { choices: voter.ballot.choices.map((c) => c.projectId), receipt: voter.ballot.receipt, updatedAt: voter.ballot.updatedAt } : null,
    projects,
  });
});

votingRouter.post("/vote/redeem", async (req, res) => {
  const event = await eventBySlug((req.params as { slug?: string }).slug);
  const window = votingWindow(event);
  if (window !== "open") enforce(window === "off" ? "voting_off" : window === "not_open" ? "voting_not_open" : "voting_closed");
  if (event.votingMode !== "invite") throw new HttpError(409, "not_invite_mode", "This event doesn't use ballot codes.");
  const { code } = z.object({ code: z.string().trim().min(6).max(64) }).parse(req.body);

  const ip = req.ip ?? null;
  const failures = ip ? await prisma.auditLog.count({ where: { eventId: event.id, action: "vote.code_rejected", ip, createdAt: { gt: new Date(Date.now() - 3_600_000) } } }) : 0;
  if (failures >= REDEEM_FAILURES_PER_IP_PER_HOUR) throw new HttpError(429, "too_many_attempts", "Too many wrong codes from this network. Try again in an hour.");

  const invite = await prisma.voteInvite.findUnique({ where: { codeHash: sha256(canonicalCode(code)) }, include: { voter: true } });
  if (!invite || invite.eventId !== event.id || invite.revokedAt) {
    await audit({ ...fromRequest(req), eventId: event.id, action: "vote.code_rejected", entityType: "VoteInvite", entityId: null, after: { reason: invite?.revokedAt ? "revoked" : "unknown" } });
    throw new HttpError(404, "invalid_code", "That ballot code isn't valid for this event.");
  }
  if (invite.voter) {
    await audit({ ...fromRequest(req), eventId: event.id, action: "vote.code_rejected", entityType: "VoteInvite", entityId: invite.id, after: { reason: "already_used" } });
    throw new HttpError(409, "code_used", "That ballot code has already been used. Each code works on one device.");
  }
  const token = randomToken();
  const voter = await prisma.$transaction(async (tx) => {
    const v = await tx.voter.create({
      data: { eventId: event.id, kind: "invite", inviteId: invite.id, identityKey: `invite:${invite.id}`, tokenHash: sha256(token), ip, userAgent: req.get("user-agent")?.slice(0, 300) ?? null },
    });
    await appendAudit(tx, { ...fromRequest(req), actorLabel: "voter:invite", eventId: event.id, action: "vote.code_redeemed", entityType: "Voter", entityId: v.id, after: { label: invite.label } });
    return v;
  });
  setInviteCookie(res, event, token);
  res.status(201).json({ voterId: voter.id });
});

function setInviteCookie(res: Response, event: Event, token: string) {
  // Kept for a month after voting closes, so the voter can come back and check their receipt.
  const until = new Date((event.votingClosesAt ?? new Date()).getTime() + 30 * DAY);
  res.cookie(inviteCookie(event), token, { httpOnly: true, sameSite: "lax", secure: config.cookieSecure, path: "/", expires: until });
}

const BallotBody = z.object({ projectIds: z.array(z.uuid()).max(20) });

votingRouter.put("/ballot", async (req, res) => {
  const event = await eventBySlug((req.params as { slug?: string }).slug);
  const [access, r] = await Promise.all([accessFor(req.actor, event.id), resolveVoter(req, event)]);
  enforce(decideVote(access, votingWindow(event), event.votingMode, r.identity));
  const { projectIds } = BallotBody.parse(req.body);
  const picks = [...new Set(projectIds)];
  if (picks.length !== projectIds.length) throw new HttpError(400, "duplicate_choice", "A project can only be picked once.");
  if (picks.length > event.votesPerVoter) throw new HttpError(422, "too_many_choices", `You can pick up to ${event.votesPerVoter} projects.`);

  const all = await ballotProjects(event.id);
  const byId = new Map(all.map((p) => [p.id, p]));
  const unknown = picks.find((id) => !byId.has(id));
  if (unknown) throw new HttpError(400, "invalid_project", "One of those projects isn't on this ballot.");
  const own = picks.find((id) => r.userId && byId.get(id)!.team.members.some((m) => m.userId === r.userId));
  if (own) throw new HttpError(403, "own_project", "You can't vote for your own team's project.");
  if (await inboxTaken(event.id, r)) throw new HttpError(409, "duplicate_inbox", "Another account using this email inbox has already voted in this event.");

  const order = ballotOrder(all.map((p) => p.id), `${event.id}:${r.identityKey}`);
  const position = new Map(order.map((id, i) => [id, i]));
  const ip = req.ip ?? null;
  const userAgent = req.get("user-agent")?.slice(0, 300) ?? null;

  try {
    const ballot = await prisma.$transaction(async (tx) => {
      const voter = r.inviteVoterId
        ? await tx.voter.findUniqueOrThrow({ where: { id: r.inviteVoterId } })
        : await tx.voter.upsert({
            where: { eventId_identityKey: { eventId: event.id, identityKey: r.identityKey! } },
            create: { eventId: event.id, kind: event.votingMode, userId: r.userId, identityKey: r.identityKey!, emailKey: r.emailKey, ip, userAgent },
            update: {},
          });
      const existing = await tx.ballot.findUnique({ where: { voterId: voter.id } });
      const b = existing
        ? await tx.ballot.update({ where: { id: existing.id }, data: { ip, userAgent } })
        : await tx.ballot.create({ data: { eventId: event.id, voterId: voter.id, receipt: makeReceipt(), ip, userAgent } });
      // One save at a time per ballot, so two tabs can't race past the vote limit.
      await tx.$executeRaw`SELECT id FROM "Ballot" WHERE id = ${b.id}::uuid FOR UPDATE`;
      const before = await tx.ballotChoice.findMany({ where: { ballotId: b.id }, select: { projectId: true } });
      const keep = new Set(picks);
      await tx.ballotChoice.deleteMany({ where: { ballotId: b.id, projectId: { notIn: picks } } });
      const add = picks.filter((id) => !before.some((c) => c.projectId === id));
      if (add.length) await tx.ballotChoice.createMany({ data: add.map((projectId) => ({ ballotId: b.id, projectId, position: position.get(projectId)! })) });
      // The audit trail records that a ballot changed and how big it is, never what it says.
      await appendAudit(tx, {
        ...fromRequest(req), actorLabel: r.inviteVoterId ? "voter:invite" : undefined, eventId: event.id,
        action: existing ? "ballot.changed" : "ballot.cast", entityType: "Ballot", entityId: b.id,
        after: { choices: keep.size },
      });
      return tx.ballot.findUniqueOrThrow({ where: { id: b.id }, include: { choices: true } });
    });
    res.json({ ballot: { choices: ballot.choices.map((c) => c.projectId), receipt: ballot.receipt, updatedAt: ballot.updatedAt } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const target = JSON.stringify(err.meta?.target ?? "");
      if (target.includes("emailKey")) throw new HttpError(409, "duplicate_inbox", "Another account using this email inbox has already voted in this event.");
      // Two first saves racing (e.g. two tabs): the other one won; saving again will update it.
      throw new HttpError(409, "save_conflict", "Your ballot was being saved from another tab. Try again.");
    }
    throw err;
  }
});

// ── organizer ───────────────────────────────────────────────────────────────

votingRouter.get("/voting/admin", async (req, res) => {
  const event = await staffEvent(req);
  const [voters, ballots, choices, invites, last] = await Promise.all([
    prisma.voter.groupBy({ by: ["kind"], where: { eventId: event.id }, _count: true }),
    prisma.ballot.count({ where: { eventId: event.id, choices: { some: {} } } }),
    prisma.ballotChoice.count({ where: { ballot: { eventId: event.id } } }),
    prisma.voteInvite.findMany({ where: { eventId: event.id }, select: { label: true, createdAt: true, revokedAt: true, voter: { select: { id: true } } } }),
    prisma.ballot.findFirst({ where: { eventId: event.id }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
  ]);
  const batches = new Map<string, { label: string; total: number; redeemed: number; revoked: number; createdAt: Date }>();
  for (const i of invites) {
    const b = batches.get(i.label) ?? { label: i.label, total: 0, redeemed: 0, revoked: 0, createdAt: i.createdAt };
    b.total++;
    if (i.voter) b.redeemed++;
    else if (i.revokedAt) b.revoked++;
    if (i.createdAt < b.createdAt) b.createdAt = i.createdAt;
    batches.set(i.label, b);
  }
  res.json({
    settings: { opensAt: event.votingOpensAt, closesAt: event.votingClosesAt, mode: event.votingMode, votesPerVoter: event.votesPerVoter, voterDomains: event.voterDomains },
    window: votingWindow(event),
    submissionsCloseAt: event.submissionsCloseAt,
    // Turnout only. Per-project numbers stay sealed until results are published.
    turnout: {
      voters: voters.reduce((s, v) => s + v._count, 0),
      byKind: Object.fromEntries(voters.map((v) => [v.kind, v._count])),
      ballots,
      choices,
      lastBallotAt: last?.updatedAt ?? null,
    },
    locked: ballots > 0 || voters.length > 0,
    invites: [...batches.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
  });
});

const SettingsBody = z.object({
  opensAt: z.iso.datetime().nullable(),
  closesAt: z.iso.datetime().nullable(),
  mode: z.enum(["email", "invite", "accounts"]),
  votesPerVoter: z.number().int().min(1).max(20),
  voterDomains: z
    .array(z.string().trim().toLowerCase().regex(/^@?[a-z0-9-]+(\.[a-z0-9-]+)+$/, "Use a domain like company.com").transform((d) => d.replace(/^@/, "")))
    .max(50)
    .default([]),
});

votingRouter.put("/voting/settings", async (req, res) => {
  const event = await staffEvent(req);
  const body = SettingsBody.parse(req.body);
  const opensAt = body.opensAt ? new Date(body.opensAt) : null;
  const closesAt = body.closesAt ? new Date(body.closesAt) : null;
  if (opensAt && !closesAt) throw new HttpError(400, "closes_required", "Set when voting closes.");
  if (opensAt && closesAt && closesAt <= opensAt) throw new HttpError(400, "invalid_window", "Voting must close after it opens.");
  if (opensAt && opensAt < event.submissionsCloseAt)
    throw new HttpError(400, "opens_before_deadline", "Voting opens once the submission deadline has passed, so every voter sees the same final list of projects.");

  const cast = await prisma.voter.count({ where: { eventId: event.id } });
  if (cast > 0) {
    const same = body.mode === event.votingMode && body.votesPerVoter === event.votesPerVoter && [...body.voterDomains].sort().join() === [...event.voterDomains].sort().join();
    if (!same) throw new HttpError(409, "voting_locked", "People have already voted, so how they vote (mode, votes per voter, allowed domains) can't change. You can still move the dates.");
    if (!opensAt) throw new HttpError(409, "voting_locked", "People have already voted, so voting can't be switched off. Close it early instead.");
  }
  const before = { opensAt: event.votingOpensAt, closesAt: event.votingClosesAt, mode: event.votingMode, votesPerVoter: event.votesPerVoter, voterDomains: event.voterDomains };
  const after = { opensAt, closesAt, mode: body.mode, votesPerVoter: body.votesPerVoter, voterDomains: body.voterDomains };
  await prisma.$transaction(async (tx) => {
    await tx.event.update({ where: { id: event.id }, data: { votingOpensAt: opensAt, votingClosesAt: closesAt, votingMode: body.mode, votesPerVoter: body.votesPerVoter, voterDomains: body.voterDomains } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "voting.settings_updated", entityType: "Event", entityId: event.id, before, after });
  });
  res.json({ settings: after, window: votingWindow({ votingOpensAt: opensAt, votingClosesAt: closesAt }) });
});

votingRouter.post("/voting/invites", async (req, res) => {
  const event = await staffEvent(req);
  const body = z.object({ count: z.number().int().min(1).max(1000), label: z.string().trim().min(1).max(60) }).parse(req.body);
  const codes = Array.from({ length: body.count }, makeInviteCode);
  await prisma.$transaction(async (tx) => {
    await tx.voteInvite.createMany({ data: codes.map((c) => ({ eventId: event.id, codeHash: sha256(canonicalCode(c)), label: body.label, createdById: req.actor!.id })) });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "voting.invites_created", entityType: "Event", entityId: event.id, after: { count: body.count, label: body.label } });
  });
  // The only time these codes exist in plain text. We keep hashes.
  res.status(201).json({ label: body.label, codes: codes.map((code) => ({ code, url: `/events/${event.slug}/vote?code=${encodeURIComponent(code)}` })) });
});

votingRouter.post("/voting/invites/revoke", async (req, res) => {
  const event = await staffEvent(req);
  const { label } = z.object({ label: z.string().trim().min(1).max(60) }).parse(req.body);
  const result = await prisma.$transaction(async (tx) => {
    const r = await tx.voteInvite.updateMany({ where: { eventId: event.id, label, revokedAt: null, voter: null }, data: { revokedAt: new Date() } });
    await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "voting.invites_revoked", entityType: "Event", entityId: event.id, after: { label, revoked: r.count } });
    return r;
  });
  res.json({ revoked: result.count });
});
