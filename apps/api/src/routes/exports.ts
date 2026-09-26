import { Router } from "express";
import { prisma } from "../db";
import { accessFor, decideOrganize, enforce } from "../policy";
import { eventBySlug } from "../lib/events";
import { toCsv } from "../lib/csv";
import { compositeScore, type CriterionSpec } from "../judging/composite";

export const exportsRouter = Router({ mergeParams: true });

function sendCsv(res: import("express").Response, filename: string, body: string) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(body);
}

/** Organizer-only. Raw weighted scores per project; normalized results come from a published run. */
exportsRouter.get("/results.csv", async (req, res) => {
  const event = await eventBySlug((req.params as { slug?: string }).slug);
  enforce(decideOrganize(await accessFor(req.actor, event.id)));

  const [criteriaRows, projects] = await Promise.all([
    prisma.criterion.findMany({ where: { eventId: event.id } }),
    prisma.project.findMany({
      where: { eventId: event.id, status: "submitted" },
      select: {
        id: true, externalId: true, title: true, duplicateOfId: true,
        team: { select: { name: true } },
        track: { select: { name: true } },
        reviews: { where: { status: "submitted" }, select: { scores: { select: { criterionId: true, value: true } } } },
      },
    }),
  ]);
  const criteria: CriterionSpec[] = criteriaRows.map((c) => ({ id: c.id, key: c.key, weight: Number(c.weight), minScore: c.minScore, maxScore: c.maxScore }));

  const rows = projects.map((p) => {
    const composites = p.reviews
      .map((r) => compositeScore(new Map(r.scores.map((s) => [s.criterionId, s.value])), criteria))
      .filter((x): x is number => x !== null);
    const raw = composites.length ? composites.reduce((a, b) => a + b, 0) / composites.length : null;
    const flags = [p.duplicateOfId ? "duplicate" : null, composites.length < 3 ? "provisional" : null].filter(Boolean).join(";");
    return { p, raw, n: composites.length, flags };
  });
  rows.sort((a, b) => (b.raw ?? -1) - (a.raw ?? -1) || a.p.title.localeCompare(b.p.title));

  let rank = 0;
  const body = toCsv(
    ["rank", "project_id", "external_id", "title", "team", "track", "n_reviews", "raw_score", "flags"],
    rows.map((r) => [
      r.p.duplicateOfId ? "" : ++rank,
      r.p.id, r.p.externalId, r.p.title, r.p.team.name, r.p.track?.name ?? "",
      r.n, r.raw === null ? "" : r.raw.toFixed(3), r.flags,
    ]),
  );
  sendCsv(res, `${event.slug}-results.csv`, body);
});
