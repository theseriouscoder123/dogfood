import { Router } from "express";
import { config } from "../config";
import { buildSpec } from "../openapi/spec";

export const metaRouter = Router();

metaRouter.get("/health", (_req, res) => {
  res.json({ ok: true });
});

let spec: string | null = null;

/** The OpenAPI 3.1 document for this API. Built once; it only changes with the code. */
metaRouter.get("/openapi.json", (_req, res) => {
  spec ??= JSON.stringify(buildSpec(config.publicBaseUrl), null, 2);
  res.type("application/json").send(spec);
});
