import { Router } from "express";
import { prisma } from "../db";
import { accessFor, decideReadJudgeScores, enforce, isStaff } from "../policy";
import { eventBySlug } from "../lib/events";
import { notFound, unauthenticated } from "../lib/http";

export const judgingRouter = Router({ mergeParams: true });

/**
 * GET /api/events/:slug/judges/:judgeRef/scores
 * judgeRef is "me", a judge's imported id (e.g. "jdg_24"), or a user id.
 * Isolation is decided before the lookup result is revealed, so a judge cannot
 * probe which other judges exist: anything that isn't them is a 403.
 */
judgingRouter.get("/:judgeRef/scores", async (req, res) => {
  const { slug, judgeRef } = req.params as { slug?: string; judgeRef: string };
  const event = await eventBySlug(slug);
  if (!req.actor) throw unauthenticated();
  const access = await accessFor(req.actor, event.id);

  let judgeUserId: string | null;
  if (judgeRef === "me") {
    judgeUserId = req.actor.id;
  } else {
    const isUuid = /^[0-9a-f-]{36}$/i.test(judgeRef);
    const role = await prisma.eventRole.findFirst({
      where: { eventId: event.id, role: "judge", ...(isUuid ? { userId: judgeRef } : { externalId: judgeRef }) },
      select: { userId: true },
    });
    judgeUserId = role?.userId ?? null;
  }

  enforce(decideReadJudgeScores(access, judgeUserId));
  if (judgeUserId === null) throw notFound("Judge"); // only staff can get here

  const [judge, reviews] = await Promise.all([
    prisma.eventRole.findFirst({
      where: { eventId: event.id, userId: judgeUserId, role: "judge" },
      select: { externalId: true, user: { select: { id: true, name: true } } },
    }),
    prisma.review.findMany({
      // Scoped by judge at the query level too: a forgotten check upstream still can't leak peers.
      where: { eventId: event.id, judgeId: judgeUserId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, status: true, comment: true, submittedAt: true,
        project: { select: { id: true, externalId: true, title: true, track: { select: { name: true } } } },
        scores: { select: { value: true, criterion: { select: { key: true } } } },
      },
    }),
  ]);
  if (!judge && !isStaff(access)) throw notFound("Judge");

  res.json({
    judge: judge ? { id: judge.user.id, name: judge.user.name, externalId: judge.externalId } : { id: judgeUserId },
    reviews: reviews.map((r) => ({
      id: r.id,
      status: r.status,
      comment: r.comment,
      submittedAt: r.submittedAt,
      project: { id: r.project.id, externalId: r.project.externalId, title: r.project.title, track: r.project.track?.name ?? null },
      scores: Object.fromEntries(r.scores.map((s) => [s.criterion.key, s.value])),
    })),
  });
});
