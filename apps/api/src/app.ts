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

export function createApp() {
  const app = express();
  app.set("trust proxy", true); // behind the nginx gateway
  app.disable("x-powered-by");

  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.setHeader("X-Request-Id", req.requestId);
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(loadActor);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/events", eventsRouter);
  app.use("/api/events/:slug/projects", projectsRouter);
  app.use("/api/events/:slug/judges", judgingRouter);
  app.use("/api/events/:slug/export", exportsRouter);

  app.use("/api", apiNotFound);
  app.use(errorHandler);
  return app;
}
