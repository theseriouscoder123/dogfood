// Just enough of OpenAPI 3.1 / JSON Schema to render the API reference page.

export type JsonSchema = {
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  const?: unknown;
  anyOf?: JsonSchema[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  description?: string;
  default?: unknown;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  $ref?: string;
};

export type OpenApiOperation = {
  operationId: string;
  tags: string[];
  summary: string;
  description?: string;
  "x-access": string;
  "x-browser-only"?: boolean;
  parameters?: Array<{ name: string; in: "path" | "query"; required: boolean; description?: string; schema: JsonSchema }>;
  requestBody?: { content: Record<string, { schema: JsonSchema }> };
  responses: Record<string, { description: string; content?: Record<string, { schema: JsonSchema }> }>;
};

export type OpenApiDoc = {
  openapi: string;
  info: { title: string; version: string; description: string };
  tags: Array<{ name: string; description: string }>;
  paths: Record<string, Record<string, OpenApiOperation>>;
  webhooks?: Record<string, { post: { summary: string; requestBody: { content: { "application/json": { schema: JsonSchema } } } } }>;
};

export type Row = { name: string; depth: number; type: string; required: boolean; notes: string[]; description?: string };

/** A one-line type: "string (uuid)", "integer", "string | null", "\"open\" | \"off\"", "array of string". */
export function typeLabel(s: JsonSchema): string {
  if (s.$ref) return s.$ref.split("/").pop()!;
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(" | ");
  if (s.anyOf) return [...new Set(s.anyOf.map(typeLabel))].join(" | ");
  const t = Array.isArray(s.type) ? s.type.join(" | ") : (s.type ?? "any");
  if (t === "array") return `array of ${s.items ? typeLabel(s.items) : "any"}`;
  if (t === "object" && s.additionalProperties && typeof s.additionalProperties === "object" && !s.properties) return `map of ${typeLabel(s.additionalProperties)}`;
  return s.format ? `${t} (${s.format})` : t;
}

function notes(s: JsonSchema): string[] {
  const n: string[] = [];
  const range = (lo?: number, hi?: number, unit = "") => (lo !== undefined && hi !== undefined ? `${lo}–${hi}${unit}` : lo !== undefined ? `≥ ${lo}${unit}` : hi !== undefined ? `≤ ${hi}${unit}` : null);
  const len = range(s.minLength, s.maxLength, " chars");
  if (len) n.push(len);
  const num = range(s.minimum ?? s.exclusiveMinimum, s.maximum);
  if (num) n.push(s.exclusiveMinimum !== undefined ? num.replace("≥", ">") : num);
  const items = range(s.minItems, s.maxItems, " items");
  if (items) n.push(items);
  if (s.default !== undefined) n.push(`default ${JSON.stringify(s.default)}`);
  if (s.pattern) n.push(`matches ${s.pattern}`);
  return n;
}

/** Nested properties as indented rows. Objects inside arrays show their fields too. */
export function schemaRows(schema: JsonSchema, depth = 0, prefix = ""): Row[] {
  if (depth > 4) return [];
  const obj = schema.type === "array" && schema.items?.properties ? schema.items : schema;
  if (!obj.properties) return [];
  const rows: Row[] = [];
  for (const [key, prop] of Object.entries(obj.properties)) {
    const inner = prop.anyOf?.find((a) => a.properties || a.items?.properties) ?? prop;
    rows.push({ name: `${prefix}${key}`, depth, type: typeLabel(prop), required: obj.required?.includes(key) ?? false, notes: notes(prop), description: prop.description });
    rows.push(...schemaRows(inner, depth + 1, inner.type === "array" ? `${prefix}${key}[].` : `${prefix}${key}.`));
  }
  return rows;
}

export const METHOD_ORDER = ["get", "post", "put", "patch", "delete"];
