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

/** Participants can create or edit a submission only while the window is open. Staff are not exempt. */
export function decideWriteSubmission(a: EventAccess, window: SubmissionWindow): Decision | "closed" | "not_open" {
  if (!a.actor) return "unauthenticated";
  if (window !== "open") return window;
  return a.roles.has("participant") ? "allow" : "forbidden";
}

/** Turn a decision into the matching HTTP error. */
export function enforce(decision: Decision | "closed" | "not_open"): void {
  switch (decision) {
    case "allow":
      return;
    case "unauthenticated":
      throw unauthenticated();
    case "forbidden":
      throw forbidden();
    case "closed":
      throw new HttpError(403, "submissions_closed", "Submissions for this event are closed.");
    case "not_open":
      throw new HttpError(403, "submissions_not_open", "Submissions for this event have not opened yet.");
  }
}
