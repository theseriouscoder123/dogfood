// Public discovery across all events: GET /api/projects (search every submitted project).
import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";

export const discoverRouter = Router();

export const DiscoverQuery = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
});

const PAGE = 24;

discoverRouter.get("/", async (req, res) => {
  const { q, page } = DiscoverQuery.parse(req.query);
  const where: Prisma.ProjectWhereInput = { status: "submitted", duplicateOfId: null, event: { publishedAt: { not: null } } };
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { tagline: { contains: q, mode: "insensitive" } },
      { team: { name: { contains: q, mode: "insensitive" } } },
      { techTags: { has: q.toLowerCase() } },
      { event: { name: { contains: q, mode: "insensitive" } } },
    ];
  }
  const [total, projects] = await Promise.all([
    prisma.project.count({ where }),
    prisma.project.findMany({
      where,
      orderBy: [{ submittedAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * PAGE,
      take: PAGE,
      select: {
        id: true, title: true, tagline: true, thumbnailUrl: true, techTags: true, submittedAt: true,
        team: { select: { name: true } },
        track: { select: { name: true } },
        event: { select: { slug: true, name: true } },
      },
    }),
  ]);
  res.json({ total, page, pageSize: PAGE, projects });
});
