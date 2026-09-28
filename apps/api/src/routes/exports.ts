// CSV exports for every stage of an event. Mounted at /api/events/:slug/export. Organizer-only.
//
//   GET /export            the list below, with row counts
//   GET /export/<file>     one CSV (RFC 4180, formula-injection safe; see lib/csv.ts)
//
// Every download is recorded in the audit log: these files hold personal data and scores,
// so "who took a copy, and when" is part of the record.
import { Router, type Request, type Response } from "express";
import type { Event } from "@prisma/client";
import { prisma } from "../db";
import { accessFor, decideOrganize, enforce } from "../policy";
import { appendAudit, fromRequest } from "../audit";
import { eventBySlug } from "../lib/events";
import { HttpError, notFound } from "../lib/http";
import { toCsv } from "../lib/csv";
import { compositeScore, type CriterionSpec } from "../judging/composite";
import { computeResults, loadResultInputs, normalizeOptions } from "../judging/results";
import { reviewTarget } from "./progress";
import { votingWindow } from "../policy";
import { receiptHash } from "../voting/tally";
import { exportEvent } from "../portability/export";

export const exportsRouter = Router({ mergeParams: true });

type Table = { header: string[]; rows: unknown[][] };
type ExportDef = { file: string; title: string; stage: string; description: string; build: (event: Event) => Promise<Table> };

const joinList = (xs: string[]) => xs.join("; ");

async function criteriaSpecs(eventId: string) {
  const rows = await prisma.criterion.findMany({ where: { eventId }, orderBy: [{ position: "asc" }, { key: "asc" }] });
  return { rows, specs: rows.map((c): CriterionSpec => ({ id: c.id, key: c.key, weight: Number(c.weight), minScore: c.minScore, maxScore: c.maxScore })) };
}

const EXPORTS: ExportDef[] = [
  {
    file: "participants.csv",
    title: "Participants",
    stage: "Registration",
    description: "Everyone registered to build, with their team and role.",
    async build(event) {
      const [roles, members] = await Promise.all([
        prisma.eventRole.findMany({ where: { eventId: event.id, role: "participant" }, select: { createdAt: true, externalId: true, user: { select: { id: true, name: true, email: true } } } }),
        prisma.teamMember.findMany({ where: { eventId: event.id }, select: { userId: true, role: true, joinedAt: true, team: { select: { id: true, name: true } }, user: { select: { id: true, name: true, email: true } } } }),
      ]);
      const memberOf = new Map(members.map((m) => [m.userId, m]));
      const people = new Map(roles.map((r) => [r.user.id, { user: r.user, externalId: r.externalId, registeredAt: r.createdAt as Date | null }]));
      for (const m of members) if (!people.has(m.userId)) people.set(m.userId, { user: m.user, externalId: null, registeredAt: null });
      return {
        header: ["user_id", "external_id", "name", "email", "team_id", "team", "team_role", "joined_team_at", "registered_at"],
        rows: [...people.values()]
          .sort((a, b) => a.user.name.localeCompare(b.user.name))
          .map(({ user, externalId, registeredAt }) => {
            const m = memberOf.get(user.id);
            return [user.id, externalId, user.name, user.email, m?.team.id, m?.team.name, m?.role, m?.joinedAt, registeredAt];
          }),
      };
    },
  },
  {
    file: "teams.csv",
    title: "Teams",
    stage: "Registration",
    description: "Teams with their members, captain and project status.",
    async build(event) {
      const teams = await prisma.team.findMany({
        where: { eventId: event.id },
        orderBy: { name: "asc" },
        select: {
          id: true, externalId: true, name: true, createdAt: true,
          members: { orderBy: { joinedAt: "asc" }, select: { role: true, user: { select: { name: true, email: true } } } },
          projects: { select: { id: true, title: true, status: true } },
        },
      });
      return {
        header: ["team_id", "external_id", "name", "size", "captain", "member_names", "member_emails", "project_id", "project_title", "project_status", "created_at"],
        rows: teams.map((t) => {
          const p = t.projects.find((x) => x.status !== "withdrawn") ?? t.projects[0];
          return [
            t.id, t.externalId, t.name, t.members.length, t.members.find((m) => m.role === "captain")?.user.name,
            joinList(t.members.map((m) => m.user.name)), joinList(t.members.map((m) => m.user.email)),
            p?.id, p?.title, p?.status, t.createdAt,
          ];
        }),
      };
    },
  },
  {
    file: "projects.csv",
    title: "Projects",
    stage: "Submissions",
    description: "Every project, including drafts, with links, tech and answers to your custom questions.",
    async build(event) {
      const [questions, projects] = await Promise.all([
        prisma.submissionQuestion.findMany({ where: { eventId: event.id }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
        prisma.project.findMany({
          where: { eventId: event.id },
          orderBy: { title: "asc" },
          select: {
            id: true, externalId: true, title: true, tagline: true, status: true, submittedAt: true, updatedAt: true,
            repoUrl: true, demoUrl: true, videoUrl: true, techTags: true,
            team: { select: { name: true } }, track: { select: { name: true } },
            duplicateOf: { select: { id: true, externalId: true } },
            answers: { select: { questionId: true, value: true } },
          },
        }),
      ]);
      return {
        header: [
          "project_id", "external_id", "title", "tagline", "team", "track", "status", "submitted_at", "updated_at",
          "repo_url", "demo_url", "video_url", "tech", "duplicate_of",
          ...questions.map((q) => `q: ${q.label}${q.isPublic ? "" : " (private)"}`),
        ],
        rows: projects.map((p) => {
          const answer = new Map(p.answers.map((a) => [a.questionId, a.value]));
          return [
            p.id, p.externalId, p.title, p.tagline, p.team.name, p.track?.name, p.status, p.submittedAt, p.updatedAt,
            p.repoUrl, p.demoUrl, p.videoUrl, joinList(p.techTags), p.duplicateOf ? p.duplicateOf.externalId ?? p.duplicateOf.id : "",
            ...questions.map((q) => answer.get(q.id) ?? ""),
          ];
        }),
      };
    },
  },
  {
    file: "judges.csv",
    title: "Judges",
    stage: "Judging",
    description: "Judges, their tracks, declared conflicts and review progress.",
    async build(event) {
      const [roles, tracks, assignments, conflicts] = await Promise.all([
        prisma.eventRole.findMany({ where: { eventId: event.id, role: "judge" }, select: { externalId: true, user: { select: { id: true, name: true, email: true } } } }),
        prisma.judgeTrack.findMany({ where: { eventId: event.id }, select: { userId: true, track: { select: { name: true } } } }),
        prisma.assignment.findMany({ where: { eventId: event.id }, select: { judgeId: true, status: true } }),
        prisma.conflictOfInterest.findMany({ where: { eventId: event.id }, select: { judgeId: true, team: { select: { name: true } } } }),
      ]);
      const n = (id: string, s: string) => assignments.filter((a) => a.judgeId === id && a.status === s).length;
      return {
        header: ["judge_id", "external_id", "name", "email", "tracks", "assigned", "submitted", "in_progress", "not_started", "recused", "conflicts"],
        rows: roles
          .sort((a, b) => a.user.name.localeCompare(b.user.name))
          .map(({ user: u, externalId }) => [
            u.id, externalId, u.name, u.email,
            joinList(tracks.filter((t) => t.userId === u.id).map((t) => t.track.name).sort()),
            assignments.filter((a) => a.judgeId === u.id && a.status !== "recused").length,
            n(u.id, "submitted"), n(u.id, "in_progress"), n(u.id, "assigned"), n(u.id, "recused"),
            joinList(conflicts.filter((c) => c.judgeId === u.id).map((c) => c.team.name)),
          ]),
      };
    },
  },
  {
    file: "assignments.csv",
    title: "Assignments",
    stage: "Judging",
    description: "Who reviews what, where each review stands, and which batch created it.",
    async build(event) {
      const [assignments, roles] = await Promise.all([
        prisma.assignment.findMany({
          where: { eventId: event.id },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true, status: true, createdAt: true, openedAt: true, recusalReason: true,
            batch: { select: { name: true } },
            judge: { select: { id: true, name: true } },
            project: { select: { id: true, externalId: true, title: true, track: { select: { name: true } } } },
            review: { select: { submittedAt: true } },
          },
        }),
        prisma.eventRole.findMany({ where: { eventId: event.id, role: "judge" }, select: { userId: true, externalId: true } }),
      ]);
      const judgeExt = new Map(roles.map((r) => [r.userId, r.externalId]));
      return {
        header: ["assignment_id", "project_id", "project_external_id", "project", "track", "judge_id", "judge_external_id", "judge", "status", "batch", "assigned_at", "opened_at", "submitted_at", "recusal_reason"],
        rows: assignments.map((a) => [
          a.id, a.project.id, a.project.externalId, a.project.title, a.project.track?.name, a.judge.id, judgeExt.get(a.judge.id), a.judge.name,
          a.status, a.batch?.name, a.createdAt, a.openedAt, a.review?.submittedAt, a.recusalReason,
        ]),
      };
    },
  },
  {
    file: "reviews.csv",
    title: "Reviews",
    stage: "Judging",
    description: "Submitted reviews, one row per criterion (the long format stats tools want). Drafts are left out.",
    async build(event) {
      const [{ rows: criteria, specs }, reviews, roles] = await Promise.all([
        criteriaSpecs(event.id),
        prisma.review.findMany({
          where: { eventId: event.id, status: "submitted" },
          orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
          select: {
            id: true, assignmentId: true, judgeId: true, comment: true, submittedAt: true,
            project: { select: { id: true, externalId: true, title: true } },
            assignment: { select: { judge: { select: { name: true } } } },
            scores: { select: { criterionId: true, value: true } },
          },
        }),
        prisma.eventRole.findMany({ where: { eventId: event.id, role: "judge" }, select: { userId: true, externalId: true } }),
      ]);
      const judgeExt = new Map(roles.map((r) => [r.userId, r.externalId]));
      const rows: unknown[][] = [];
      for (const r of reviews) {
        const value = new Map(r.scores.map((s) => [s.criterionId, s.value]));
        const composite = compositeScore(value, specs);
        for (const c of criteria) {
          if (!value.has(c.id)) continue;
          rows.push([
            r.id, r.assignmentId, r.project.id, r.project.externalId, r.project.title, r.judgeId, judgeExt.get(r.judgeId), r.assignment.judge.name,
            c.key, c.label, Number(c.weight), value.get(c.id), c.minScore, c.maxScore, composite === null ? "" : composite.toFixed(3), r.submittedAt, r.comment,
          ]);
        }
      }
      return {
        header: ["review_id", "assignment_id", "project_id", "project_external_id", "project", "judge_id", "judge_external_id", "judge", "criterion", "criterion_label", "weight", "score", "min", "max", "review_composite", "submitted_at", "comment"],
        rows,
      };
    },
  },
  {
    file: "results.csv",
    title: "Results",
    stage: "Results",
    description: "The ranking: raw and normalized scores, rank ranges and flags. Uses the published run, or a live computation until one is published.",
    async build(event) {
      const f = (x: number | null, d = 3) => (x === null ? "" : x.toFixed(d));
      const header = [
        "rank", "project_id", "external_id", "title", "team", "track", "n_reviews", "raw_score", "normalized_score", "std_error",
        "raw_rank", "rank_low", "rank_high", "p_top_k", "flags", "source",
      ];
      if (event.publishedRunId) {
        const rows = await prisma.projectResult.findMany({
          where: { runId: event.publishedRunId },
          include: { project: { select: { externalId: true, title: true, team: { select: { name: true } }, track: { select: { name: true } } } } },
        });
        rows.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.project.title.localeCompare(b.project.title));
        return {
          header,
          rows: rows.map((r) => [
            r.rank ?? "", r.projectId, r.project.externalId, r.project.title, r.project.team.name, r.project.track?.name ?? "", r.nReviews,
            f(r.rawScore), f(r.normalizedScore), f(r.stdError), r.rawRank ?? "", r.rankLow ?? "", r.rankHigh ?? "", f(r.pTop, 2), r.flags.join(";"), `published run ${r.runId}`,
          ]),
        };
      }
      const inputs = await loadResultInputs(prisma, event.id);
      const computed = computeResults(inputs, normalizeOptions({ minReviews: await reviewTarget(event.id) }));
      return {
        header,
        rows: computed.projects.map((p) => [
          p.rank ?? "", p.projectId, p.externalId, p.title, p.team, p.track?.name ?? "", p.nReviews,
          f(p.rawScore), f(p.normalizedScore), f(p.stdError), p.rawRank ?? "", p.rankLow ?? "", p.rankHigh ?? "", f(p.pTop, 2), p.flags.join(";"), "live (not published)",
        ]),
      };
    },
  },
  {
    file: "comments.csv",
    title: "Comments",
    stage: "Community",
    description: "Every project comment, including removed ones, with who removed it and why, and how often it was reported.",
    async build(event) {
      const rows = await prisma.comment.findMany({
        where: { eventId: event.id },
        orderBy: { createdAt: "asc" },
        include: {
          author: { select: { name: true, email: true } },
          project: { select: { id: true, externalId: true, title: true } },
          hiddenBy: { select: { name: true } },
          _count: { select: { reports: true } },
        },
      });
      return {
        header: ["comment_id", "project_id", "project_external_id", "project", "reply_to", "author", "author_email", "created_at", "edited_at", "state", "hidden_by", "hidden_reason", "reports", "body"],
        rows: rows.map((c) => [
          c.id, c.project.id, c.project.externalId, c.project.title, c.parentId, c.author.name, c.author.email, c.createdAt, c.editedAt,
          c.deletedAt ? "deleted" : c.hiddenAt ? "hidden" : "visible",
          c.hiddenAt ? c.hiddenBy?.name ?? "automatic" : "", c.hiddenReason, c._count.reports, c.body,
        ]),
      };
    },
  },
  {
    file: "ballots.csv",
    title: "Ballots",
    stage: "Community",
    description: "Every community ballot, anonymous (receipt hash, picks, where each was shown). Sealed until voting closes.",
    async build(event) {
      if (votingWindow(event) !== "closed") throw new HttpError(409, "sealed", "Ballots stay sealed until voting closes, for organizers too.");
      const ballots = await prisma.ballot.findMany({
        where: { eventId: event.id, choices: { some: {} } },
        select: { receipt: true, status: true, quarantineReason: true, choices: { select: { position: true, project: { select: { id: true, title: true } } } } },
      });
      const rows = ballots
        .map((b) => ({ hash: receiptHash(b.receipt), b }))
        .sort((x, y) => x.hash.localeCompare(y.hash))
        .flatMap(({ hash, b }) => b.choices.map((c) => [hash, b.status, b.quarantineReason, c.project.id, c.project.title, c.position + 1]));
      return { header: ["receipt_hash", "status", "quarantine_reason", "project_id", "project", "shown_at_position"], rows };
    },
  },
  {
    file: "audit.csv",
    title: "Audit log",
    stage: "Record",
    description: "Every change to this event, hash-chained. Recompute the chain to prove nothing was edited.",
    async build(event) {
      const entries = await prisma.auditLog.findMany({
        where: { eventId: event.id },
        orderBy: { id: "asc" },
        select: { id: true, createdAt: true, actorLabel: true, action: true, entityType: true, entityId: true, before: true, after: true, prevHash: true, hash: true },
      });
      const json = (v: unknown) => (v === null || v === undefined ? "" : JSON.stringify(v));
      return {
        header: ["seq", "created_at", "actor", "action", "entity_type", "entity_id", "before", "after", "prev_hash", "hash"],
        rows: entries.map((e) => [e.id.toString(), e.createdAt, e.actorLabel, e.action, e.entityType, e.entityId, json(e.before), json(e.after), e.prevHash, e.hash]),
      };
    },
  },
];

async function staffEvent(req: Request) {
  const event = await eventBySlug((req.params as { slug?: string }).slug);
  enforce(decideOrganize(await accessFor(req.actor, event.id)));
  return event;
}

/** The downloadable files, in the order the export page lists them. */
export const EXPORT_FILES = EXPORTS.map((x) => x.file);

exportsRouter.get("/", async (req, res) => {
  const event = await staffEvent(req);
  // A file that isn't available yet (sealed ballots) is listed with the reason instead of a count.
  const tables = await Promise.all(EXPORTS.map((x) => x.build(event).catch((err: unknown) => (err instanceof HttpError ? err : Promise.reject(err)))));
  res.json({
    exports: EXPORTS.map((x, i) => {
      const t = tables[i]!;
      return {
        file: x.file, title: x.title, stage: x.stage, description: x.description,
        rows: t instanceof HttpError ? null : t.rows.length,
        columns: t instanceof HttpError ? null : t.header.length,
        unavailable: t instanceof HttpError ? t.message : null,
        url: `/api/events/${event.slug}/export/${x.file}`,
      };
    }),
  });
});

/** The whole event as one dogfood-event/v1 file: the way out, and (via POST /api/events/import) the way back in. */
exportsRouter.get("/event.json", async (req, res) => {
  const event = await staffEvent(req);
  const file = await exportEvent(prisma, event);
  await prisma.$transaction((tx) =>
    appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "export.downloaded", entityType: "Event", entityId: event.id, after: { file: "event.json" } }),
  );
  res.setHeader("Content-Disposition", `attachment; filename="${event.slug}.dogfood-event.json"`);
  res.type("application/json").send(`${JSON.stringify(file, null, 2)}
`);
});

exportsRouter.get("/:file", async (req: Request, res: Response) => {
  const def = EXPORTS.find((x) => x.file === (req.params as { file: string }).file);
  const event = await staffEvent(req);
  if (!def) throw notFound("Export");
  const { header, rows } = await def.build(event);
  await prisma.$transaction((tx) =>
    appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "export.downloaded", entityType: "Event", entityId: event.id, after: { file: def.file, rows: rows.length } }),
  );
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${event.slug}-${def.file}"`);
  res.setHeader("Cache-Control", "no-store");
  // A UTF-8 byte order mark so Excel shows names with accents correctly.
  res.send("﻿" + toCsv(header, rows));
});
