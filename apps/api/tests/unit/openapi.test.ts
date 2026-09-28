import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Router } from "express";
import { MOUNTS, RAW_BODY_MOUNTS } from "../../src/app";
import { OPERATIONS, PARAMS } from "../../src/openapi/operations";
import { buildSpec, operationId, pathParams, toOpenApiPath } from "../../src/openapi/spec";

type Layer = { route?: { path: string; methods: Record<string, boolean> } };

/** Every METHOD + path actually served, read from the routers themselves. */
function mountedRoutes(): string[] {
  const out: string[] = [];
  for (const [base, router] of [...RAW_BODY_MOUNTS, ...MOUNTS] as Array<readonly [string, Router]>) {
    for (const layer of (router as unknown as { stack: Layer[] }).stack) {
      if (!layer.route) continue;
      const path = (base + layer.route.path).replace(/\/$/, "");
      for (const m of Object.keys(layer.route.methods)) if (m !== "_all") out.push(`${m.toUpperCase()} ${path}`);
    }
  }
  return out.sort();
}

const documented = () => OPERATIONS.map((o) => `${o.method.toUpperCase()} ${o.path}`).sort();

describe("OpenAPI catalogue matches the mounted routes", () => {
  it("documents every route the API serves", () => {
    const missing = mountedRoutes().filter((r) => !documented().includes(r));
    expect(missing, "routes with no entry in src/openapi/operations.ts").toEqual([]);
  });

  it("documents no route the API doesn't serve", () => {
    const stale = documented().filter((r) => !mountedRoutes().includes(r));
    expect(stale, "entries in src/openapi/operations.ts with no route").toEqual([]);
  });

  it("lists each operation once", () => {
    expect(new Set(documented()).size).toBe(OPERATIONS.length);
  });
});

describe("OpenAPI document", () => {
  const spec = buildSpec("http://localhost:8080") as {
    openapi: string;
    paths: Record<string, Record<string, { operationId: string; parameters?: Array<{ name: string; in: string }>; requestBody?: unknown; responses: Record<string, unknown>; security: unknown[] }>>;
  };
  const ops = Object.values(spec.paths).flatMap((p) => Object.entries(p).map(([method, op]) => ({ method, op })));

  it("is OpenAPI 3.1 with every operation", () => {
    expect(spec.openapi).toBe("3.1.0");
    expect(ops).toHaveLength(OPERATIONS.length);
  });

  it("gives every operation a unique, stable id", () => {
    const ids = ops.map((o) => o.op.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(operationId({ method: "get", path: "/api/events/:slug/projects/:projectId" })).toBe("getEventsBySlugProjectsByProjectId");
  });

  it("declares and describes every path parameter", () => {
    for (const o of OPERATIONS) {
      for (const name of pathParams(o.path)) expect(PARAMS[name], `${o.path}: ${name}`).toBeTruthy();
      const declared = spec.paths[toOpenApiPath(o.path)]![o.method]!.parameters?.filter((p) => p.in === "path").map((p) => p.name) ?? [];
      expect(declared).toEqual(pathParams(o.path));
    }
  });

  it("only takes request bodies on methods that have them", () => {
    for (const { method, op } of ops) if (op.requestBody) expect(["post", "put", "patch"]).toContain(method);
  });

  it("documents the error shape on every operation", () => {
    for (const { op } of ops) expect(op.responses.default).toEqual({ description: expect.any(String), content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } });
  });

  it("marks browser-only operations as session-only", () => {
    for (const o of OPERATIONS.filter((x) => x.browserOnly)) expect(spec.paths[toOpenApiPath(o.path)]![o.method]!.security).toEqual([{ session: [] }]);
  });

  it("matches the committed docs/openapi.json (run npm run openapi after changing the API)", () => {
    const committed = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../docs/openapi.json"), "utf8"));
    expect(committed).toEqual(JSON.parse(JSON.stringify(spec)));
  });

  it("emits request schemas from the handlers' own validators", () => {
    const body = spec.paths["/api/auth/tokens"]!.post!.requestBody as { content: { "application/json": { schema: { properties: Record<string, unknown>; required: string[] } } } };
    expect(Object.keys(body.content["application/json"].schema.properties)).toEqual(["name", "scopes", "expiresInDays"]);
    expect(body.content["application/json"].schema.required).toEqual(["name", "scopes"]);
  });
});
