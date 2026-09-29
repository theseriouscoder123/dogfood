import express, { type Router } from "express";
import cookieParser from "cookie-parser";
import { randomUUID } from "node:crypto";
import { loadActor } from "./auth/session";
import { apiNotFound, errorHandler } from "./lib/http";
import { authRouter } from "./routes/auth";
import { eventsRouter } from "./routes/events";
import { projectsRouter } from "./routes/projects";
import { judgingRouter } from "./routes/judging";
import { exportsRouter } from "./routes/exports";
import { eventAdminRouter } from "./routes/eventAdmin";
import { invitesRouter, teamsRouter } from "./routes/teams";
import { filesRouter, uploadsRouter } from "./routes/uploads";
import { judgingAdminRouter } from "./routes/judgingAdmin";
import { assignmentsRouter } from "./routes/assignments";
import { judgeConsoleRouter } from "./routes/judgeConsole";
import { progressRouter } from "./routes/progress";
import { resultsRouter } from "./routes/results";
import { pairwiseRouter } from "./routes/pairwise";
import { integrityRouter } from "./routes/integrity";
import { votingRouter } from "./routes/voting";
import { commentModerationRouter, commentsRouter } from "./routes/comments";
import { tokensRouter } from "./routes/tokens";
import { metaRouter } from "./routes/meta";
import { webhooksRouter } from "./routes/webhooks";
import { recordsAdminRouter, recordsRouter } from "./routes/records";
import { communityRouter } from "./routes/community";
import { eventImportRouter } from "./routes/eventImport";
import { meRouter } from "./routes/me";
import { usersRouter } from "./routes/users";
import { discoverRouter } from "./routes/discover";
import { draftGuard } from "./lib/events";

/**
 * Every router and where it is mounted, in mount order. The OpenAPI drift test walks this table,
 * so a route can't be added without being documented. Uploads and event import parse their own
 * (bigger) bodies, so they come before the JSON parser.
 */
export const RAW_BODY_MOUNTS: ReadonlyArray<readonly [string, Router]> = [
  ["/api/uploads", uploadsRouter],
  ["/api/events/import", eventImportRouter], // whole-event files are bigger than the global JSON limit
];

export const MOUNTS: ReadonlyArray<readonly [string, Router]> = [
  ["/api", metaRouter],
  ["/api/auth/tokens", tokensRouter],
  ["/api/auth", authRouter],
  ["/api/me", meRouter],
  ["/api/users", usersRouter],
  ["/api/projects", discoverRouter],
  // before every event router: unpublished events are invisible to all but their organizers
  ["/api/events/:slug", draftGuard],
  ["/api/events", eventsRouter],
  ["/api/events", eventAdminRouter],
  ["/api/events/:slug", judgingAdminRouter],
  ["/api/events/:slug", assignmentsRouter],
  ["/api/events/:slug", progressRouter],
  ["/api/events/:slug", resultsRouter],
  ["/api/events/:slug", pairwiseRouter],
  ["/api/events/:slug", integrityRouter],
  ["/api/events/:slug", votingRouter],
  ["/api/events/:slug", commentModerationRouter],
  ["/api/events/:slug", webhooksRouter],
  ["/api/events/:slug", recordsAdminRouter],
  ["/api/events/:slug", communityRouter],
  ["/api/events/:slug/teams", teamsRouter],
  // before projectsRouter, whose "/:projectId" would otherwise swallow ".../comments"
  ["/api/events/:slug/projects/:projectId/comments", commentsRouter],
  ["/api/events/:slug/projects", projectsRouter],
  ["/api/events/:slug/judges", judgingRouter],
  ["/api/events/:slug/judging", judgeConsoleRouter],
  ["/api/events/:slug/export", exportsRouter],
  ["/api/invites", invitesRouter],
  ["/api/files", filesRouter],
  ["/api/records", recordsRouter],
];

export function createApp() {
  const app = express();
  app.set("trust proxy", true); // behind the nginx gateway
  app.disable("x-powered-by");

  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.setHeader("X-Request-Id", req.requestId);
    next();
  });
  app.use(cookieParser());
  app.use(loadActor);
  for (const [path, router] of RAW_BODY_MOUNTS) app.use(path, router);
  app.use(express.json({ limit: "1mb" }));
  for (const [path, router] of MOUNTS) app.use(path, router);

  app.use("/api", apiNotFound);
  app.use(errorHandler);
  return app;
}
