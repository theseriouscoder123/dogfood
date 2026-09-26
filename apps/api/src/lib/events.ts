import { prisma } from "../db";
import { notFound } from "./http";

export async function eventBySlug(slug: string | undefined) {
  const event = slug ? await prisma.event.findUnique({ where: { slug } }) : null;
  if (!event) throw notFound("Event");
  return event;
}
