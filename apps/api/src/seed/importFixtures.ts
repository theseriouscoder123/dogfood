// Imports the shared fixtures.json into the schema. The file is input, not our data
// model: ids become `externalId`s, people become users with per-event roles, and
// every score becomes Assignment → Review → ReviewScore rows.
//
// Idempotent: an event whose externalId already exists is left untouched, so a
// restart never overwrites what organizers changed after the first import.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Event, PrismaClient } from "@prisma/client";
import { appendAudit } from "../audit";
import { detectDuplicates } from "./duplicates";

const Id = z.string().min(1);
export const FixtureFile = z.object({
  event: z.object({ id: Id, name: z.string().min(1), submissions_close: z.iso.datetime() }),
  tracks: z.array(z.object({ id: Id, name: z.string().min(1) })),
  judges: z.array(z.object({ id: Id, name: z.string().min(1), email: z.email(), tracks: z.array(Id) })),
  teams: z.array(z.object({ id: Id, name: z.string().min(1), members: z.array(z.email()) })),
  projects: z.array(
    z.object({
      id: Id, team: Id, track: Id, title: z.string().min(1),
      summary: z.string().default(""),
      repo_url: z.string().optional(),
      submitted_at: z.iso.datetime(),
    }),
  ),
  scores: z.array(
    z.object({
      judge: Id, project: Id,
      criteria: z.record(z.string(), z.number().int()),
      comment: z.string().default(""),
    }),
  ),
});
export type FixtureFile = z.infer<typeof FixtureFile>;

export type ImportSummary = {
  tracks: number; judges: number; users: number; teams: number; projects: number;
  reviews: number; criteria: string[];
  duplicates: Array<{ project: string; duplicateOf: string; reason: string }>;
  conflicts: number;
};

const HOUR = 3_600_000;

export const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const titleCase = (s: string) => s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
export const nameFromEmail = (email: string) => titleCase(email.split("@")[0]!.replace(/[0-9._]+/g, " ").trim() || email);

function lookup<V>(map: Map<string, V>, key: string, what: string): V {
  const v = map.get(key);
  if (v === undefined) throw new Error(`fixtures.json references unknown ${what} "${key}"`);
  return v;
}

export async function importFixtures(
  prisma: PrismaClient,
  raw: unknown,
  opts: { demoPasswordHash: string | null; actorLabel: string },
): Promise<{ event: Event; created: boolean; summary: ImportSummary | null }> {
  const fx = FixtureFile.parse(raw);
  const existing = await prisma.event.findUnique({ where: { externalId: fx.event.id } });
  if (existing) return { event: existing, created: false, summary: null };

  return prisma.$transaction(
    async (tx) => {
      const close = new Date(fx.event.submissions_close);
      // The fixture only gives the close time; the other dates are derived and documented.
      const event = await tx.event.create({
        data: {
          slug: slugify(fx.event.name),
          externalId: fx.event.id,
          name: fx.event.name,
          description: "Imported from fixtures.json.",
          registrationOpensAt: new Date(close.getTime() - 30 * 24 * HOUR),
          submissionsOpenAt: new Date(close.getTime() - 72 * HOUR),
          submissionsCloseAt: close,
          judgingOpensAt: close,
          judgingClosesAt: new Date(close.getTime() + 10 * 24 * HOUR),
        },
      });
      const eventId = event.id;

      // Rubric: every criterion key seen in the scores, equal weight, 1-5.
      const criterionKeys = [...new Set(fx.scores.flatMap((s) => Object.keys(s.criteria)))];
      const criterionId = new Map(criterionKeys.map((k) => [k, randomUUID()]));
      await tx.criterion.createMany({
        data: criterionKeys.map((key, i) => ({ id: criterionId.get(key)!, eventId, key, label: titleCase(key), position: i })),
      });

      const trackId = new Map(fx.tracks.map((t) => [t.id, randomUUID()]));
      await tx.track.createMany({
        data: fx.tracks.map((t) => ({ id: trackId.get(t.id)!, eventId, externalId: t.id, name: t.name })),
      });

      // People. A person may already exist from another event; reuse them by email.
      const displayName = new Map<string, string>();
      for (const j of fx.judges) displayName.set(j.email.toLowerCase(), j.name);
      for (const t of fx.teams) for (const m of t.members) {
        const e = m.toLowerCase();
        if (!displayName.has(e)) displayName.set(e, nameFromEmail(e));
      }
      const known = await tx.user.findMany({ where: { email: { in: [...displayName.keys()] } }, select: { id: true, email: true } });
      const userId = new Map(known.map((u) => [u.email, u.id]));
      const newUsers = [...displayName].filter(([e]) => !userId.has(e)).map(([email, name]) => {
        const id = randomUUID();
        userId.set(email, id);
        return { id, email, name, passwordHash: opts.demoPasswordHash };
      });
      await tx.user.createMany({ data: newUsers });

      const judgeUser = new Map(fx.judges.map((j) => [j.id, lookup(userId, j.email.toLowerCase(), "judge email")]));
      await tx.eventRole.createMany({
        data: fx.judges.map((j) => ({ eventId, userId: judgeUser.get(j.id)!, role: "judge" as const, externalId: j.id })),
      });
      await tx.judgeTrack.createMany({
        data: fx.judges.flatMap((j) => j.tracks.map((t) => ({ eventId, userId: judgeUser.get(j.id)!, trackId: lookup(trackId, t, "track") }))),
      });

      const teamId = new Map(fx.teams.map((t) => [t.id, randomUUID()]));
      await tx.team.createMany({ data: fx.teams.map((t) => ({ id: teamId.get(t.id)!, eventId, externalId: t.id, name: t.name })) });
      await tx.teamMember.createMany({
        data: fx.teams.flatMap((t) =>
          t.members.map((m, i) => ({ teamId: teamId.get(t.id)!, eventId, userId: userId.get(m.toLowerCase())!, role: i === 0 ? ("captain" as const) : ("member" as const) })),
        ),
      });
      await tx.eventRole.createMany({
        data: fx.teams.flatMap((t) => t.members.map((m) => ({ eventId, userId: userId.get(m.toLowerCase())!, role: "participant" as const }))),
        skipDuplicates: true,
      });

      // Conflict of interest: a judge who is also a member of a team.
      const judgeByEmail = new Map(fx.judges.map((j) => [j.email.toLowerCase(), judgeUser.get(j.id)!]));
      const conflicts = fx.teams.flatMap((t) =>
        t.members.filter((m) => judgeByEmail.has(m.toLowerCase())).map((m) => ({
          eventId, judgeId: judgeByEmail.get(m.toLowerCase())!, teamId: teamId.get(t.id)!, source: "detected" as const, note: "judge is a member of this team",
        })),
      );
      await tx.conflictOfInterest.createMany({ data: conflicts, skipDuplicates: true });

      // Projects, oldest first, so the first entry of a duplicate pair is the canonical one.
      // Duplicate = same team and (same repo or same title). The later entry is flagged, not deleted.
      const projectId = new Map<string, string>();
      const duplicates: ImportSummary["duplicates"] = [];
      const projectRows = detectDuplicates(fx.projects).map(({ project: p, duplicateOf, reason }) => {
        const id = randomUUID();
        projectId.set(p.id, id);
        if (duplicateOf) duplicates.push({ project: p.id, duplicateOf, reason: reason! });
        return {
          id, eventId, externalId: p.id,
          teamId: lookup(teamId, p.team, "team"),
          trackId: lookup(trackId, p.track, "track"),
          title: p.title, tagline: p.summary, repoUrl: p.repo_url ?? null,
          status: "submitted" as const,
          submittedAt: new Date(p.submitted_at),
          duplicateOfId: duplicateOf ? projectId.get(duplicateOf)! : null,
        };
      });
      await tx.project.createMany({ data: projectRows });

      // Scores: one batch for the import, then assignment → review → per-criterion values.
      const batch = await tx.assignmentBatch.create({
        data: { eventId, name: "Imported from fixtures.json", algorithm: "import", params: { source: "fixtures.json" } },
      });
      const assignments = [], reviews = [], values = [];
      for (const s of fx.scores) {
        const assignmentId = randomUUID(), reviewId = randomUUID();
        const judgeId = lookup(judgeUser, s.judge, "judge");
        const pid = lookup(projectId, s.project, "project");
        assignments.push({ id: assignmentId, eventId, batchId: batch.id, judgeId, projectId: pid, status: "submitted" as const });
        // Review time is not in the fixture, so submittedAt stays null ("unknown") rather than invented.
        reviews.push({ id: reviewId, assignmentId, eventId, judgeId, projectId: pid, comment: s.comment, status: "submitted" as const });
        for (const [key, value] of Object.entries(s.criteria)) values.push({ reviewId, criterionId: criterionId.get(key)!, value });
      }
      await tx.assignment.createMany({ data: assignments });
      await tx.review.createMany({ data: reviews });
      await tx.reviewScore.createMany({ data: values });

      const summary: ImportSummary = {
        tracks: fx.tracks.length, judges: fx.judges.length, users: newUsers.length, teams: fx.teams.length,
        projects: fx.projects.length, reviews: fx.scores.length, criteria: criterionKeys, duplicates, conflicts: conflicts.length,
      };
      await appendAudit(tx, { eventId, actorLabel: opts.actorLabel, action: "fixtures.import", entityType: "Event", entityId: eventId, after: summary });
      return { event, created: true, summary };
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}
