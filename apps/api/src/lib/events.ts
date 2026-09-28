import { Router } from "express";
import { prisma } from "../db";
import { accessFor } from "../policy";
import { notFound } from "./http";

export async function eventBySlug(slug: string | undefined) {
  const event = slug ? await prisma.event.findUnique({ where: { slug } }) : null;
  if (!event) throw notFound("Event");
  return event;
}

/**
 * Drafts are invisible: every /api/events/:slug/... request for an unpublished event answers 404
 * unless the caller organizes it (or is an admin). One guard in front of every event router, so
 * no route can forget it.
 */
export const draftGuard = Router({ mergeParams: true });
draftGuard.use(async (req, _res, next) => {
  const slug = (req.params as { slug?: string }).slug;
  const event = slug ? await prisma.event.findUnique({ where: { slug }, select: { id: true, publishedAt: true } }) : null;
  if (event && !event.publishedAt) {
    const access = await accessFor(req.actor, event.id);
    if (!access.actor?.isAdmin && !access.roles.has("organizer")) throw notFound("Event");
  }
  next();
});
