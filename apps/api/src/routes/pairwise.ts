// Head-to-head judging, organizer side. Mounted at /api/events/:slug.
//
//   PUT /pairwise/settings   turn head-to-head judging on or off
//   GET /pairwise            the Bradley–Terry ranking, and how it compares with the rubric results
//
// Comparisons on recused assignments, withdrawn projects and flagged duplicates are left out,
// the same rules the rubric results follow.
import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { accessFor, decideOrganize, enforce, judgingWindow } from "../policy";
import { appendAudit, fromRequest } from "../audit";
import { eventBySlug } from "../lib/events";
import { computeResults, loadResultInputs, normalizeOptions } from "../judging/results";
import { pairwiseReport, type Comparison } from "../judging/pairwise";
import { reviewTarget } from "./progress";

export const pairwiseRouter = Router({ mergeParams: true });

async function staffEvent(req: Request) {
  const event = await eventBySlug((req.params as { slug?: string }).slug);
  enforce(decideOrganize(await accessFor(req.actor, event.id)));
  return event;
}

export const PairwiseSettingsBody = z.object({ enabled: z.boolean() });

pairwiseRouter.put("/pairwise/settings", async (req, res) => {
  const event = await staffEvent(req);
  const { enabled } = PairwiseSettingsBody.parse(req.body);
  if (enabled !== event.pairwiseEnabled) {
    await prisma.$transaction(async (tx) => {
      await tx.event.update({ where: { id: event.id }, data: { pairwiseEnabled: enabled } });
      await appendAudit(tx, { ...fromRequest(req), eventId: event.id, action: "pairwise.settings", entityType: "Event", entityId: event.id, before: { enabled: event.pairwiseEnabled }, after: { enabled } });
    });
  }
  res.json({ enabled });
});

pairwiseRouter.get("/pairwise", async (req, res) => {
  const event = await staffEvent(req);
  const [rows, projects, judges, inputs, target] = await Promise.all([
    prisma.pairwiseComparison.findMany({
      where: {
        eventId: event.id,
        left: { status: { not: "recused" }, project: { status: "submitted", duplicateOfId: null } },
        right: { status: { not: "recused" }, project: { status: "submitted", duplicateOfId: null } },
      },
      orderBy: { createdAt: "asc" },
      select: { judgeId: true, leftProjectId: true, rightProjectId: true, outcome: true },
    }),
    prisma.project.findMany({
      where: { eventId: event.id, status: "submitted", duplicateOfId: null },
      select: { id: true, title: true, externalId: true, thumbnailUrl: true, team: { select: { name: true } }, track: { select: { name: true } } },
    }),
    prisma.eventRole.findMany({ where: { eventId: event.id, role: "judge" }, select: { externalId: true, user: { select: { id: true, name: true } } } }),
    loadResultInputs(prisma, event.id),
    reviewTarget(event.id),
  ]);
  const comparisons: Comparison[] = rows.map((r) => ({ judgeId: r.judgeId, left: r.leftProjectId, right: r.rightProjectId, outcome: r.outcome }));
  // The rubric ranking with the default settings (what the results page previews first).
  const rubric = computeResults(inputs, normalizeOptions({ minReviews: target }));
  const rubricRanks = new Map(rubric.projects.filter((p) => p.rank !== null).map((p) => [p.projectId, p.rank!]));
  const report = pairwiseReport(projects.map((p) => p.id).sort(), comparisons, rubricRanks);
  const project = new Map(projects.map((p) => [p.id, { title: p.title, externalId: p.externalId, thumbnailUrl: p.thumbnailUrl, team: p.team.name, track: p.track?.name ?? null }]));
  const judge = new Map(judges.map((j) => [j.user.id, { name: j.user.name, externalId: j.externalId }]));
  res.json({
    enabled: event.pairwiseEnabled,
    judgingWindow: judgingWindow(event),
    comparisons: report.comparisons,
    uncompared: report.uncompared,
    agreement: report.agreement,
    disagreementThreshold: report.disagreementThreshold,
    positionBias: report.positionBias,
    projects: report.rows.map((r) => ({
      projectId: r.id, ...project.get(r.id)!, rank: r.rank, rankLow: r.rankLow, rankHigh: r.rankHigh, rating: Math.round(r.rating), se: r.se,
      wins: r.wins, losses: r.losses, ties: r.ties, comparisons: r.n, rubricRank: r.rubricRank, disagreement: r.disagreement,
    })),
    judges: report.judges
      .map((j) => ({ ...j, name: judge.get(j.judgeId)?.name ?? "Former judge", externalId: judge.get(j.judgeId)?.externalId ?? null }))
      .sort((a, b) => b.comparisons - a.comparisons || a.name.localeCompare(b.name)),
  });
});
