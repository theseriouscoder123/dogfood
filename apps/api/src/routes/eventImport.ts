// POST /api/events/import: create an event from a dogfood-event/v1 file or a DOGFOOD fixture file.
// Mounted before the global JSON parser, because whole-event files are bigger than its 1 MB limit.
import express, { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { decideImportEvent, enforce } from "../policy";
import { fromRequest } from "../audit";
import { HttpError } from "../lib/http";
import { FixtureFile } from "../seed/importFixtures";
import { EventFile, FORMAT } from "../portability/format";
import { ImportProblems, fixtureToEventFile, importEvent } from "../portability/import";

export const eventImportRouter = Router();

export const ImportQuery = z.object({
  dryRun: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => v === "true" || v === "1")
    .describe("Check the file and report what would be created, without keeping anything."),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase letters, digits and dashes").max(60).optional().describe("Use this slug instead of the one in the file."),
});

eventImportRouter.post("/", express.json({ limit: "25mb" }), async (req, res) => {
  enforce(decideImportEvent(req.actor));
  const { dryRun, slug } = ImportQuery.parse(req.query);
  const body = req.body as { format?: unknown } | undefined;
  let file: EventFile;
  let source: "dogfood-event/v1" | "fixtures";
  if (body?.format === FORMAT) {
    file = EventFile.parse(body);
    source = FORMAT;
  } else if (FixtureFile.safeParse(body).success) {
    file = EventFile.parse(fixtureToEventFile(FixtureFile.parse(body)));
    source = "fixtures";
  } else {
    throw new HttpError(400, "unknown_format", `Expected a ${FORMAT} file (from Export → Full event) or a DOGFOOD fixtures.json file.`);
  }
  try {
    const result = await importEvent(prisma, file, { slug, dryRun, audit: fromRequest(req) });
    res.status(dryRun ? 200 : 201).json({ ...result, source });
  } catch (err) {
    if (err instanceof ImportProblems) throw new HttpError(422, "import_invalid", err.message, err.problems);
    throw err;
  }
});
