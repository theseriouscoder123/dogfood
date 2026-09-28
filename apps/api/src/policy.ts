// Every permission decision lives in this file. Routes call these functions;
// they never compare roles themselves. The decide* functions are pure so the
// whole role matrix can be unit-tested cell by cell (tests/policy.test.ts).
import type { EventRoleType } from "@prisma/client";
import { prisma } from "./db";
import { HttpError, forbidden, unauthenticated } from "./lib/http";

export type Actor = { id: string; email: string; name: string; isAdmin: boolean };

export type EventAccess = {
  actor: Actor | null;
  roles: ReadonlySet<EventRoleType>;
};

export type Decision = "allow" | "unauthenticated" | "forbidden";

export async function accessFor(actor: Actor | null, eventId: string): Promise<EventAccess> {
  if (!actor) return { actor: null, roles: new Set() };
  const rows = await prisma.eventRole.findMany({ where: { eventId, userId: actor.id }, select: { role: true } });
  return { actor, roles: new Set(rows.map((r) => r.role)) };
}

/** Organizers of this event, and platform admins. */
export const isStaff = (a: EventAccess) => !!a.actor && (a.actor.isAdmin || a.roles.has("organizer"));

export function decideOrganize(a: EventAccess): Decision {
  if (!a.actor) return "unauthenticated";
  return isStaff(a) ? "allow" : "forbidden";
}

/** A judge may read their own scores; nobody but staff may read another judge's. */
export function decideReadJudgeScores(a: EventAccess, judgeUserId: string | null): Decision {
  if (!a.actor) return "unauthenticated";
  if (isStaff(a)) return "allow";
  if (a.roles.has("judge") && judgeUserId !== null && a.actor.id === judgeUserId) return "allow";
  return "forbidden";
}

export type SubmissionWindow = "not_open" | "open" | "closed";

export function submissionWindow(
  event: { submissionsOpenAt: Date; submissionsCloseAt: Date },
  now: Date = new Date(),
): SubmissionWindow {
  if (now < event.submissionsOpenAt) return "not_open";
  if (now >= event.submissionsCloseAt) return "closed";
  return "open";
}

/** Participants can create a submission only while the window is open. Staff are not exempt. */
export function decideWriteSubmission(a: EventAccess, window: SubmissionWindow): Outcome {
  if (!a.actor) return "unauthenticated";
  if (window !== "open") return window;
  return a.roles.has("participant") ? "allow" : "forbidden";
}

/** Editing or submitting an existing project: team members only, and only while submissions are open. */
export function decideEditProject(a: EventAccess, window: SubmissionWindow, isTeamMember: boolean): Outcome {
  if (!a.actor) return "unauthenticated";
  if (window !== "open") return window;
  return isTeamMember ? "allow" : "forbidden";
}

/**
 * Who can see a project. Submitted, non-duplicate projects are public (the gallery);
 * drafts and flagged duplicates only to the team and to staff. Judges get their
 * assigned projects through the judging endpoints, not through this rule.
 */
export function decideViewProject(
  a: EventAccess,
  project: { status: string; duplicateOfId: string | null },
  isTeamMember: boolean,
): Decision {
  if (project.status === "submitted" && project.duplicateOfId === null) return "allow";
  if (isStaff(a) || isTeamMember) return "allow";
  return a.actor ? "forbidden" : "unauthenticated";
}

/** Only platform admins create events; the creator becomes the event's first organizer. */
/**
 * Hosting a hackathon: any signed-in person, who becomes its organizer (the event starts as a
 * draft, visible only to them). A platform can restrict hosting to admins with HOSTING=admins.
 */
export function decideCreateEvent(actor: Actor | null, hosting: "open" | "admins" = "open"): Decision {
  if (!actor) return "unauthenticated";
  return actor.isAdmin || hosting === "open" ? "allow" : "forbidden";
}

/** Importing a whole event (with its people) is a platform-level action. */
export function decideImportEvent(actor: Actor | null): Decision {
  if (!actor) return "unauthenticated";
  return actor.isAdmin ? "allow" : "forbidden";
}

export type RegistrationWindow = "not_open" | "open" | "closed";

/** Joining an event, forming teams and accepting invites: from registration opening until submissions close. */
export function registrationWindow(
  event: { registrationOpensAt: Date | null; submissionsOpenAt: Date; submissionsCloseAt: Date },
  now: Date = new Date(),
): RegistrationWindow {
  if (now < (event.registrationOpensAt ?? event.submissionsOpenAt)) return "not_open";
  if (now >= event.submissionsCloseAt) return "closed";
  return "open";
}

/** Becoming a participant (register, create or join a team). Judges of the same event cannot compete in it. */
export function decideParticipate(a: EventAccess, window: RegistrationWindow): Outcome {
  if (!a.actor) return "unauthenticated";
  if (window === "not_open") return "registration_not_open";
  if (window === "closed") return "registration_closed";
  if (a.roles.has("judge")) return "judge_conflict";
  return "allow";
}

export type JudgingWindow = "not_open" | "open" | "closed";

/** Judges score from judgingOpensAt (default: the submission deadline) until judgingClosesAt (default: never). */
export function judgingWindow(
  event: { submissionsCloseAt: Date; judgingOpensAt: Date | null; judgingClosesAt: Date | null },
  now: Date = new Date(),
): JudgingWindow {
  if (now < (event.judgingOpensAt ?? event.submissionsCloseAt)) return "not_open";
  if (event.judgingClosesAt && now >= event.judgingClosesAt) return "closed";
  return "open";
}

/**
 * Writing a review: the judge must be assigned (the caller looks the assignment up scoped to
 * the judge, so "not assigned" never reaches here), the assignment must not be recused, and
 * judging must be open. Staff have no special power to score on a judge's behalf.
 */
export function decideScore(a: EventAccess, window: JudgingWindow, assignment: { status: string }): Outcome {
  if (!a.actor) return "unauthenticated";
  if (!a.roles.has("judge")) return "forbidden";
  if (assignment.status === "recused") return "recused";
  if (window === "not_open") return "judging_not_open";
  if (window === "closed") return "judging_closed";
  return "allow";
}

export type VotingWindow = "off" | "not_open" | "open" | "closed";

/** Community voting runs from votingOpensAt to votingClosesAt; without an opening time it's off. */
export function votingWindow(event: { votingOpensAt: Date | null; votingClosesAt: Date | null }, now: Date = new Date()): VotingWindow {
  if (!event.votingOpensAt) return "off";
  if (now < event.votingOpensAt) return "not_open";
  if (event.votingClosesAt && now >= event.votingClosesAt) return "closed";
  return "open";
}

export type VoterIdentity =
  | { kind: "none" }
  | { kind: "user"; emailVerified: boolean; domainAllowed: boolean; disposable?: boolean }
  | { kind: "invite" };

/**
 * Casting or changing a community vote. The window comes first (so everyone sees the same reason
 * when voting is closed), then who you are: organizers and judges have their own say in the
 * result and don't vote in the community one; then whether the event's voting mode accepts
 * the identity you have. "Is this project yours" is checked per project by the caller.
 */
export function decideVote(a: EventAccess, window: VotingWindow, mode: "email" | "invite" | "accounts", id: VoterIdentity): Outcome {
  if (window === "off") return "voting_off";
  if (window === "not_open") return "voting_not_open";
  if (window === "closed") return "voting_closed";
  if (a.roles.has("organizer") || a.roles.has("judge")) return "staff_cannot_vote";
  if (mode === "invite") return id.kind === "invite" ? "allow" : "invite_required";
  if (id.kind !== "user") return "unauthenticated";
  if (!id.domainAllowed) return "domain_not_allowed";
  if (id.disposable) return "disposable_email";
  if (mode === "email" && !id.emailVerified) return "email_unverified";
  return "allow";
}

export type CommentsMode = "open" | "read_only" | "off";

/**
 * Posting a comment. Judges wait until judging has closed: a judge's public remark about a
 * project could sway other judges and looks like a verdict before the results. Everyone else
 * who is signed in can comment while the event allows it.
 */
export function decideComment(a: EventAccess, mode: CommentsMode, judging: JudgingWindow): Outcome {
  if (mode === "off") return "comments_off";
  if (mode === "read_only") return "comments_read_only";
  if (!a.actor) return "unauthenticated";
  if (a.roles.has("judge") && !a.roles.has("organizer") && judging !== "closed") return "judge_cannot_comment";
  return "allow";
}

export type Outcome =
  | Decision
  | "closed"
  | "not_open"
  | "registration_closed"
  | "registration_not_open"
  | "judge_conflict"
  | "judging_not_open"
  | "judging_closed"
  | "recused"
  | "voting_off"
  | "voting_not_open"
  | "voting_closed"
  | "staff_cannot_vote"
  | "invite_required"
  | "domain_not_allowed"
  | "email_unverified"
  | "disposable_email"
  | "rate_limited"
  | "comments_off"
  | "comments_read_only"
  | "judge_cannot_comment";

const refusals: Record<Exclude<Outcome, "allow">, () => HttpError> = {
  unauthenticated,
  forbidden: () => forbidden(),
  closed: () => new HttpError(403, "submissions_closed", "Submissions for this event are closed."),
  not_open: () => new HttpError(403, "submissions_not_open", "Submissions for this event have not opened yet."),
  registration_closed: () => new HttpError(403, "registration_closed", "Registration for this event is closed."),
  registration_not_open: () => new HttpError(403, "registration_not_open", "Registration for this event has not opened yet."),
  judge_conflict: () => new HttpError(403, "judge_conflict", "Judges of this event cannot take part in it as participants."),
  judging_not_open: () => new HttpError(403, "judging_not_open", "Judging hasn't opened yet."),
  judging_closed: () => new HttpError(403, "judging_closed", "Judging has closed; reviews can no longer change."),
  recused: () => new HttpError(409, "recused", "You recused yourself from this project."),
  voting_off: () => new HttpError(404, "voting_off", "This event doesn't have community voting."),
  voting_not_open: () => new HttpError(403, "voting_not_open", "Voting hasn't opened yet."),
  voting_closed: () => new HttpError(403, "voting_closed", "Voting has closed."),
  staff_cannot_vote: () => new HttpError(403, "staff_cannot_vote", "Organizers and judges have their own say in the results, so they don't vote in the community vote."),
  invite_required: () => new HttpError(403, "invite_required", "Voting in this event needs a ballot code from the organizers."),
  domain_not_allowed: () => new HttpError(403, "domain_not_allowed", "Voting is limited to email addresses from the organizers' allowed domains."),
  email_unverified: () => new HttpError(403, "email_unverified", "Confirm your email first: we'll send you a one-time voting link."),
  disposable_email: () => new HttpError(403, "disposable_email", "Throwaway email addresses can't vote. Use an address you keep."),
  rate_limited: () => new HttpError(429, "rate_limited", "Too many ballots from this network in the last hour. Try again later."),
  comments_off: () => new HttpError(404, "comments_off", "Comments are turned off for this event."),
  comments_read_only: () => new HttpError(403, "comments_read_only", "Comments are closed for this event; existing ones stay visible."),
  judge_cannot_comment: () => new HttpError(403, "judge_cannot_comment", "Judges can comment once judging has closed, so a public remark can't sway the scoring."),
};

/** Turn a decision into the matching HTTP error. */
export function enforce(outcome: Outcome): void {
  if (outcome !== "allow") throw refusals[outcome]();
}
