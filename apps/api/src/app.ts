import express from "express";
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
import { integrityRouter } from "./routes/integrity";
import { votingRouter } from "./routes/voting";
import { commentModerationRouter, commentsRouter } from "./routes/comments";

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
  // Uploads read the raw body, so they are mounted before the JSON parser.
  app.use("/api/uploads", uploadsRouter);
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/events", eventsRouter);
  app.use("/api/events", eventAdminRouter);
  app.use("/api/events/:slug", judgingAdminRouter);
  app.use("/api/events/:slug", assignmentsRouter);
  app.use("/api/events/:slug", progressRouter);
  app.use("/api/events/:slug", resultsRouter);
  app.use("/api/events/:slug", integrityRouter);
  app.use("/api/events/:slug", votingRouter);
  app.use("/api/events/:slug", commentModerationRouter);
  app.use("/api/events/:slug/teams", teamsRouter);
  app.use("/api/events/:slug/projects/:projectId/comments", commentsRouter);
  app.use("/api/events/:slug/projects", projectsRouter);
  app.use("/api/events/:slug/judges", judgingRouter);
  app.use("/api/events/:slug/judging", judgeConsoleRouter);
  app.use("/api/events/:slug/export", exportsRouter);
  app.use("/api/invites", invitesRouter);
  app.use("/api/files", filesRouter);

  app.use("/api", apiNotFound);
  app.use(errorHandler);
  return app;
}
