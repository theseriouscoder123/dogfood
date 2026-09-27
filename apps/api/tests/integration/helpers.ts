// Shared fixtures for integration tests: real app, real database, fast setup via Prisma.
import request from "supertest";
import { randomUUID } from "node:crypto";
import { createApp } from "../../src/app";
import { prisma } from "../../src/db";
import { sha256 } from "../../src/lib/crypto";

export const app = createApp();
export const api = () => request(app);
export { prisma };

const HOUR = 3_600_000;
const uid = () => randomUUID().slice(0, 8);

export type TestUser = { id: string; email: string; name: string; cookie: string };

/** A user with a live session. */
export async function makeUser(opts: { admin?: boolean; name?: string; password?: boolean } = {}): Promise<TestUser> {
  const tag = uid();
  const u = await prisma.user.create({
    data: { email: `user-${tag}@test.local`, name: opts.name ?? `User ${tag}`, isAdmin: !!opts.admin, passwordHash: opts.password === false ? null : "scrypt$x" },
  });
  const token = `test-${tag}-${uid()}`;
  await prisma.session.create({ data: { tokenHash: sha256(token), userId: u.id, expiresAt: new Date(Date.now() + 24 * HOUR) } });
  return { id: u.id, email: u.email, name: u.name, cookie: `sid=${token}` };
}

/** An event whose submissions are open now, with an organizer, two tracks and a 1–5 rubric. */
export async function makeEvent(opts: { open?: boolean } = {}) {
  const now = Date.now();
  const open = opts.open ?? true;
  const organizer = await makeUser({ name: "Olive Organizer" });
  const event = await prisma.event.create({
    data: {
      slug: `evt-${uid()}`,
      name: "Test Event",
      registrationOpensAt: new Date(now - 48 * HOUR),
      submissionsOpenAt: new Date(now - 24 * HOUR),
      submissionsCloseAt: new Date(now + (open ? 24 : -1) * HOUR),
      judgingOpensAt: open ? new Date(now + 25 * HOUR) : new Date(now - 0.5 * HOUR),
      judgingClosesAt: new Date(now + 240 * HOUR),
    },
  });
  await prisma.eventRole.create({ data: { eventId: event.id, userId: organizer.id, role: "organizer" } });
  const [trackA, trackB] = await Promise.all([
    prisma.track.create({ data: { eventId: event.id, name: "Track A" } }),
    prisma.track.create({ data: { eventId: event.id, name: "Track B" } }),
  ]);
  return { event, organizer, trackA, trackB, base: `/api/events/${event.slug}` };
}

/** A team with one member and a submitted project in the given track. */
export async function makeTeamWithProject(eventId: string, trackId: string | null, title = `Project ${uid()}`) {
  const member = await makeUser();
  await prisma.eventRole.create({ data: { eventId, userId: member.id, role: "participant" } });
  const team = await prisma.team.create({ data: { eventId, name: `Team ${uid()}` } });
  await prisma.teamMember.create({ data: { teamId: team.id, eventId, userId: member.id, role: "captain" } });
  const project = await prisma.project.create({
    data: { eventId, teamId: team.id, trackId, title, tagline: "t", description: "d", repoUrl: "https://example.org/r", status: "submitted", submittedAt: new Date() },
  });
  return { member, team, project };
}

/** Make someone a judge directly (bypassing the invite flow) with optional tracks. */
export async function makeJudge(eventId: string, trackIds: string[] = []) {
  const judge = await makeUser({ name: `Judge ${uid()}` });
  await prisma.eventRole.create({ data: { eventId, userId: judge.id, role: "judge" } });
  if (trackIds.length) await prisma.judgeTrack.createMany({ data: trackIds.map((trackId) => ({ eventId, userId: judge.id, trackId })) });
  return judge;
}

/** Assignment plus (optionally) a submitted review with the given criterion scores. */
export async function makeReview(eventId: string, judgeId: string, projectId: string, scores?: Record<string, number>) {
  const assignment = await prisma.assignment.create({ data: { eventId, judgeId, projectId, status: scores ? "submitted" : "assigned" } });
  if (!scores) return { assignment, review: null };
  const review = await prisma.review.create({
    data: { assignmentId: assignment.id, eventId, judgeId, projectId, status: "submitted", submittedAt: new Date() },
  });
  await prisma.reviewScore.createMany({ data: Object.entries(scores).map(([criterionId, value]) => ({ reviewId: review.id, criterionId, value })) });
  return { assignment, review };
}
