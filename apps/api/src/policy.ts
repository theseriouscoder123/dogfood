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
export function decideCreateEvent(actor: Actor | null): Decision {
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

export type Outcome =
  | Decision
  | "closed"
  | "not_open"
  | "registration_closed"
  | "registration_not_open"
  | "judge_conflict";

const refusals: Record<Exclude<Outcome, "allow">, () => HttpError> = {
  unauthenticated,
  forbidden: () => forbidden(),
  closed: () => new HttpError(403, "submissions_closed", "Submissions for this event are closed."),
  not_open: () => new HttpError(403, "submissions_not_open", "Submissions for this event have not opened yet."),
  registration_closed: () => new HttpError(403, "registration_closed", "Registration for this event is closed."),
  registration_not_open: () => new HttpError(403, "registration_not_open", "Registration for this event has not opened yet."),
  judge_conflict: () => new HttpError(403, "judge_conflict", "Judges of this event cannot take part in it as participants."),
};

/** Turn a decision into the matching HTTP error. */
export function enforce(outcome: Outcome): void {
  if (outcome !== "allow") throw refusals[outcome]();
}
