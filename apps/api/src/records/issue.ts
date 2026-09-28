// Issuing signed records for an event: a participation record for every judge who submitted a
// review, and a certificate for every member of a team with a submitted project.
//
// A statement says only what the portal can stand behind. A judge's record commits to the exact
// reviews (sha256 over them) without revealing a single score: if a judge's work is ever
// questioned, the organizer can show the reviews and anyone can check them against the digest.
// Running issuance again re-signs only the people whose facts changed (for example, placements
// once results are published); their old record is marked superseded, never edited.
import { randomUUID } from "node:crypto";
import type { Event, Prisma, RecordType } from "@prisma/client";
import { prisma } from "../db";
import { config } from "../config";
import { canonicalJson, sha256 } from "../lib/crypto";
import { judgingWindow, submissionWindow } from "../policy";
import { appendAudit, type AuditEntry } from "../audit";
import { votingData } from "../routes/voting";
import { getSigner } from "./keys";

export const STATEMENT_VERSION = 1;

type Subject = { userId: string; name: string; type: RecordType; claims: Record<string, unknown> };

/** Records can be issued once the facts are final: judging closed (or, with no judging dates, submissions closed). */
export function issuable(event: Pick<Event, "submissionsCloseAt" | "judgingOpensAt" | "judgingClosesAt">, now = new Date()): boolean {
  if (event.judgingClosesAt) return judgingWindow(event, now) === "closed";
  return submissionWindow({ ...event, submissionsOpenAt: event.submissionsCloseAt }, now) === "closed";
}

/** The digest a judge's record commits to: every submitted review with its scores, in a fixed order. */
export function reviewsDigest(reviews: Array<{ id: string; projectId: string; submittedAt: Date | null; scores: Record<string, number> }>): string {
  const rows = [...reviews].sort((a, b) => a.id.localeCompare(b.id)).map((r) => ({ reviewId: r.id, projectId: r.projectId, submittedAt: r.submittedAt, scores: r.scores }));
  return `sha256:${sha256(canonicalJson(rows))}`;
}

async function judgeSubjects(eventId: string): Promise<Subject[]> {
  const reviews = await prisma.review.findMany({
    where: { eventId, status: "submitted" },
    select: { id: true, judgeId: true, projectId: true, submittedAt: true, scores: { select: { value: true, criterion: { select: { key: true } } } } },
  });
  const judgeIds = [...new Set(reviews.map((r) => r.judgeId))];
  const [users, tracks] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: judgeIds } }, select: { id: true, name: true } }),
    prisma.judgeTrack.findMany({ where: { eventId, userId: { in: judgeIds } }, select: { userId: true, track: { select: { name: true } } } }),
  ]);
  return users.map((u) => {
    const mine = reviews.filter((r) => r.judgeId === u.id);
    return {
      userId: u.id,
      name: u.name,
      type: "judge_participation",
      claims: {
        reviewsSubmitted: mine.length,
        projectsReviewed: new Set(mine.map((r) => r.projectId)).size,
        tracks: tracks.filter((t) => t.userId === u.id).map((t) => t.track.name).sort(),
        reviewsDigest: reviewsDigest(mine.map((r) => ({ id: r.id, projectId: r.projectId, submittedAt: r.submittedAt, scores: Object.fromEntries(r.scores.map((s) => [s.criterion.key, s.value])) }))),
      },
    };
  });
}

async function participantSubjects(event: Event): Promise<Subject[]> {
  const projects = await prisma.project.findMany({
    where: { eventId: event.id, status: "submitted", duplicateOfId: null },
    select: { id: true, title: true, team: { select: { name: true, members: { select: { user: { select: { id: true, name: true } } } } } }, track: { select: { name: true } } },
  });
  const placement = new Map<string, { rank: number; of: number; runId: string; method: string }>();
  if (event.publishedRunId) {
    const run = await prisma.normalizationRun.findUniqueOrThrow({ where: { id: event.publishedRunId }, select: { id: true, method: true, results: { where: { rank: { not: null } }, select: { projectId: true, rank: true } } } });
    for (const r of run.results) placement.set(r.projectId, { rank: r.rank!, of: run.results.length, runId: run.id, method: run.method });
  }
  const peoples = new Map<string, { rank: number; votes: number }>();
  if (event.votingPublishedAt) for (const r of (await votingData(event.id)).ranking) if (r.votes > 0) peoples.set(r.project.id, { rank: r.rank, votes: r.votes });

  return projects.flatMap((p) =>
    p.team.members.map((m) => ({
      userId: m.user.id,
      name: m.user.name,
      type: "participation" as const,
      claims: {
        team: p.team.name,
        project: { id: p.id, title: p.title, track: p.track?.name ?? null, url: `${config.publicBaseUrl}/events/${event.slug}/projects/${p.id}` },
        placement: placement.get(p.id) ?? null,
        peoplesChoice: peoples.get(p.id) ?? null,
      },
    })),
  );
}

/** Everything a statement asserts apart from its id and time; two records with the same facts are the same record. */
const factsOf = (s: unknown) => {
  const { event, subject, claims, type } = s as Record<string, unknown>;
  return canonicalJson({ event, subject, claims, type });
};

export type IssueResult = { issued: number; superseded: number; unchanged: number };

export async function issueRecords(event: Event, audit: Omit<AuditEntry, "action" | "entityType">): Promise<IssueResult> {
  const signer = await getSigner();
  const subjects = [...(await judgeSubjects(event.id)), ...(await participantSubjects(event))];
  const eventFacts = { slug: event.slug, name: event.name, startedAt: event.submissionsOpenAt.toISOString(), endedAt: (event.judgingClosesAt ?? event.submissionsCloseAt).toISOString() };

  return prisma.$transaction(
    async (tx) => {
      // Serialise issuance per event, so two organizers pressing the button can't double-issue.
      await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${event.id}::uuid FOR UPDATE`;
      const current = await tx.signedRecord.findMany({ where: { eventId: event.id, supersededById: null, revokedAt: null } });
      const result: IssueResult = { issued: 0, superseded: 0, unchanged: 0 };
      const issuedAt = new Date().toISOString();

      for (const s of subjects) {
        const id = randomUUID();
        const statement = {
          id,
          type: s.type,
          version: STATEMENT_VERSION,
          issuer: { name: "Dogfood", url: config.publicBaseUrl },
          kid: signer.kid,
          issuedAt,
          event: eventFacts,
          subject: { name: s.name, role: s.type === "judge_participation" ? "judge" : "participant" },
          claims: s.claims,
          verify: `${config.publicBaseUrl}/verify/${id}`,
        };
        const existing = current.find((r) => r.userId === s.userId && r.type === s.type);
        if (existing && factsOf(existing.statement) === factsOf(statement)) {
          result.unchanged++;
          continue;
        }
        // A revoked record stays revoked and isn't replaced automatically; skip that person.
        if (!existing && (await tx.signedRecord.count({ where: { eventId: event.id, userId: s.userId, type: s.type, supersededById: null, revokedAt: { not: null } } })) > 0) continue;
        // The old record steps aside first (its foreign key to the new one is checked at commit).
        if (existing) {
          await tx.signedRecord.update({ where: { id: existing.id }, data: { supersededById: id } });
          result.superseded++;
        }
        await tx.signedRecord.create({
          data: { id, eventId: event.id, userId: s.userId, type: s.type, statement: statement as Prisma.InputJsonValue, signature: signer.sign(canonicalJson(statement)), kid: signer.kid, issuedAt, issuedById: audit.actor?.id ?? null },
        });
        result.issued++;
      }
      await appendAudit(tx, { ...audit, eventId: event.id, action: "records.issued", entityType: "Event", entityId: event.id, after: { ...result, kid: signer.kid } });
      return result;
    },
    { timeout: 60_000 },
  );
}
