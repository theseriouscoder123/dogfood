// Builds the OpenAPI 3.1 document from the operation catalogue. Pure: no database, no request.
import { z } from "zod";
import { ACCESS, OPERATIONS, PARAMS, TAGS, type Operation } from "./operations";
import { ErrorResponse } from "./schemas";
import { API_TOKEN_PREFIX } from "../auth/apiTokens";

type Json = Record<string, unknown>;

export const toOpenApiPath = (path: string) => path.replace(/:(\w+)/g, "{$1}");
export const pathParams = (path: string) => [...path.matchAll(/:(\w+)/g)].map((m) => m[1]!);

/** getEventsBySlugProjectsByProjectId: stable, unique, derived only from method and path. */
export function operationId(op: Pick<Operation, "method" | "path">): string {
  const words = op.path
    .replace(/^\/api\//, "")
    .split("/")
    .flatMap((seg) => (seg.startsWith(":") ? ["by", seg.slice(1)] : seg.split(/[^A-Za-z0-9]+/)))
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1));
  return op.method + words.join("");
}

/**
 * zod → JSON Schema, minus noise: the $schema header, the regexes behind well-known formats and
 * safe-integer bounds. Responses may gain fields over time, so they never claim additionalProperties: false.
 */
export function jsonSchema(schema: z.ZodType, io: "input" | "output"): Json {
  const out = z.toJSONSchema(schema, { io, unrepresentable: "any" }) as Json;
  delete out.$schema;
  return tidy(out, io) as Json;
}

const ZOD_ONLY_FORMATS = new Set(["starts_with", "ends_with", "includes", "regex"]);

function tidy(node: unknown, io: "input" | "output"): unknown {
  if (Array.isArray(node)) return node.map((n) => tidy(n, io));
  if (!node || typeof node !== "object") return node;
  const o: Json = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "format" && ZOD_ONLY_FORMATS.has(v as string)) continue; // not JSON Schema formats; the pattern carries the rule
    if (k === "pattern" && "format" in node && !ZOD_ONLY_FORMATS.has((node as Json).format as string)) continue;
    if (k === "maximum" && v === Number.MAX_SAFE_INTEGER) continue;
    if (k === "minimum" && v === Number.MIN_SAFE_INTEGER) continue;
    if (k === "additionalProperties" && io === "output" && v === false) continue;
    o[k] = tidy(v, io);
  }
  return o;
}

const errorRef = (description: string) => ({ description, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } });

function successContent(op: Operation): Json | undefined {
  if (op.status === 204) return undefined;
  if (op.produces === "text/csv") return { "text/csv": { schema: { type: "string" } } };
  if (op.produces === "text/markdown") return { "text/markdown": { schema: { type: "string" } } };
  if (op.produces === "image/*") return { "image/*": { schema: { type: "string", contentEncoding: "binary" } } };
  return { "application/json": { schema: op.response ? jsonSchema(op.response, "output") : { type: "object" } } };
}

function operation(op: Operation): Json {
  const parameters: Json[] = pathParams(op.path).map((name) => {
    const description = PARAMS[name];
    if (!description) throw new Error(`No description for path parameter "${name}" (${op.path})`);
    return { name, in: "path", required: true, description, schema: { type: "string" } };
  });
  if (op.query) {
    const q = jsonSchema(op.query, "input") as { properties?: Record<string, Json>; required?: string[] };
    for (const [name, schema] of Object.entries(q.properties ?? {})) {
      parameters.push({ name, in: "query", required: q.required?.includes(name) ?? false, schema });
    }
  }

  const status = String(op.status ?? 200);
  const content = successContent(op);
  const responses: Json = { [status]: { description: op.status === 204 ? "Done. No body." : "OK", ...(content ? { content } : {}) } };
  if (op.body || op.query || op.rawBody) responses["400"] = errorRef("The request failed validation; `details` lists the issues.");
  if (op.access !== "public") responses["401"] = errorRef("Not signed in, or the API token is invalid, expired or revoked.");
  responses["403"] = errorRef(op.browserOnly ? "Not allowed, or called with an API token (`session_required`)." : "Not allowed for this caller, or the API token lacks the scope.");
  if (pathParams(op.path).length > 0) responses["404"] = errorRef("Not found, or not visible to this caller.");
  responses["429"] = errorRef("Rate limited. See `Retry-After`.");
  responses.default = errorRef("Any other error. Every error has this shape.");

  const who = `**Who can call this:** ${ACCESS[op.access]}${op.browserOnly ? " Browser sessions only: API tokens are refused with 403 `session_required`." : ""}`;
  const auth = op.browserOnly ? [{ session: [] }] : op.access === "public" ? [{}, { apiToken: [] }, { session: [] }] : [{ apiToken: [] }, { session: [] }];

  return {
    operationId: operationId(op),
    tags: [op.tag],
    summary: op.summary,
    description: op.description ? `${op.description}\n\n${who}` : who,
    "x-access": op.access,
    ...(op.browserOnly ? { "x-browser-only": true } : {}),
    security: auth,
    ...(parameters.length ? { parameters } : {}),
    ...(op.body ? { requestBody: { required: true, content: { "application/json": { schema: jsonSchema(op.body, "input") } } } } : {}),
    ...(op.rawBody ? { requestBody: { required: true, content: { [op.rawBody]: { schema: { type: "string", contentEncoding: "binary" } } } } } : {}),
    responses,
  };
}

const INTRO = `The REST API behind the Dogfood hackathon portal. The web app is built only on this API, so everything a person can do in the portal, a script can do here.

## Authentication
- **API tokens** (for scripts): create one under *Account → API tokens* and send \`Authorization: Bearer ${API_TOKEN_PREFIX}…\`. A token acts as you, narrowed by its scopes: \`read\` allows GET only, \`write\` allows changes. Only a hash is stored, and revoking takes effect on the next request.
- **Sessions** (for browsers): \`POST /api/auth/login\` sets the \`sid\` cookie.

Permissions are checked by the API on every request, never by the client. Voting, commenting and managing tokens need a browser session, so a token can't be turned into a bot or mint new tokens.

## Rate limits
Each token may make ${"`API_TOKEN_RATE_LIMIT`"} requests a minute (600 by default). Responses carry \`RateLimit-Limit\`, \`RateLimit-Remaining\` and \`RateLimit-Reset\`; a 429 carries \`Retry-After\`. Sign-in links, uploads, ballots and comments have their own limits.

## Conventions
- JSON in and out, except CSV exports, the Markdown report, and image uploads (raw bytes).
- Ids are UUIDs. Times are ISO 8601 in UTC.
- Errors always look like \`{"error": {"code", "message", "details?"}}\`. \`code\` is stable; branch on it, not on the message.
- Every response has an \`X-Request-Id\` header; the same id is stored with audit-log entries.`;

export function buildSpec(serverUrl: string): Json {
  const paths: Record<string, Json> = {};
  for (const op of OPERATIONS) {
    const p = toOpenApiPath(op.path);
    paths[p] ??= {};
    paths[p][op.method] = operation(op);
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Dogfood API",
      version: "1.0.0",
      description: INTRO,
      license: { name: "MIT", identifier: "MIT" },
    },
    servers: [{ url: serverUrl }],
    tags: TAGS.map((t) => ({ ...t })),
    paths,
    components: {
      schemas: { Error: jsonSchema(ErrorResponse, "output") },
      securitySchemes: {
        apiToken: { type: "http", scheme: "bearer", bearerFormat: `${API_TOKEN_PREFIX}…`, description: "A personal API token." },
        session: { type: "apiKey", in: "cookie", name: "sid", description: "The browser session cookie set by /api/auth/login." },
      },
    },
  };
}
