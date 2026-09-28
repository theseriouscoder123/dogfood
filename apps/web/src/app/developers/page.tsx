import Link from "next/link";
import { Braces, Download, KeyRound, Lock } from "lucide-react";
import { api } from "@/lib/api";
import { getMe } from "@/lib/session";
import { METHOD_ORDER, schemaRows, typeLabel, type JsonSchema, type OpenApiDoc, type OpenApiOperation } from "@/lib/openapi";
import { Markdown } from "@/components/Markdown";
import { Card, Pill } from "@/components/ui";
import { OperationFilter } from "./OperationFilter";

export const metadata = { title: "API reference" };

const METHOD_STYLE: Record<string, string> = {
  get: "bg-success-soft text-success border-success/25",
  post: "bg-primary-soft text-primary border-primary/20",
  put: "bg-warn-soft text-warn border-warn/25",
  patch: "bg-warn-soft text-warn border-warn/25",
  delete: "bg-danger-soft text-danger border-danger/25",
};

const ACCESS_LABEL: Record<string, string> = {
  public: "Public",
  signed_in: "Signed in",
  participant: "Participant",
  team_member: "Team member",
  judge: "Judge",
  organizer: "Organizer",
  admin: "Admin",
  voter: "Voter",
};

const anchor = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

type Op = OpenApiOperation & { method: string; path: string };

export default async function DevelopersPage() {
  const [spec, me] = await Promise.all([api<OpenApiDoc>("/api/openapi.json"), getMe()]);
  const ops: Op[] = Object.entries(spec.paths).flatMap(([path, methods]) => Object.entries(methods).map(([method, op]) => ({ ...op, method, path })));
  const byTag = spec.tags.map((t) => ({
    ...t,
    ops: ops.filter((o) => o.tags[0] === t.name).sort((a, b) => a.path.localeCompare(b.path) || METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method)),
  }));
  const [intro, ...sections] = spec.info.description.split(/\n(?=## )/);

  return (
    <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-4 pt-8 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="hidden lg:sticky lg:top-24 lg:block lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto">
        <p className="px-3 pb-2 text-[11px] font-bold uppercase tracking-wider text-muted">Guide</p>
        {["Quick start", "Authentication", "Rate limits", "Conventions", "Webhooks"].map((s) => (
          <a key={s} href={`#${s === "Quick start" ? "quick-start" : `guide-${anchor(s)}`}`} className="block rounded-lg px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink">
            {s}
          </a>
        ))}
        <p className="px-3 pb-2 pt-5 text-[11px] font-bold uppercase tracking-wider text-muted">Reference</p>
        {byTag.map((t) => (
          <a key={t.name} href={`#${anchor(t.name)}`} className="flex items-center justify-between rounded-lg px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink">
            {t.name} <span className="text-xs tabular-nums text-muted">{t.ops.length}</span>
          </a>
        ))}
        <a href="#webhook-events" className="flex items-center justify-between rounded-lg px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink">
          Webhook events <span className="text-xs tabular-nums text-muted">{Object.keys(spec.webhooks ?? {}).length}</span>
        </a>
      </aside>

      <div className="min-w-0 space-y-8">
        <header className="rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-8">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="primary">
              <Braces className="size-3.5" /> OpenAPI {spec.openapi}
            </Pill>
            <Pill>v{spec.info.version}</Pill>
            <Pill>{ops.length} operations</Pill>
          </div>
          <h1 className="mt-3 text-3xl font-extrabold sm:text-4xl">{spec.info.title}</h1>
          <Markdown className="mt-3 max-w-3xl text-[15px] text-ink-2">{intro!}</Markdown>
          <div className="mt-5 flex flex-wrap gap-3">
            <a href="/api/openapi.json" download="dogfood-openapi.json" className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-primary px-4 text-sm font-semibold text-primary-ink hover:bg-primary-hover">
              <Download className="size-4" /> openapi.json
            </a>
            <Link href={me.user ? "/account/tokens" : "/login?next=/account/tokens"} className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-line bg-surface px-4 text-sm font-semibold hover:border-line-strong hover:bg-surface-2">
              <KeyRound className="size-4" /> {me.user ? "Your API tokens" : "Log in to create a token"}
            </Link>
          </div>
        </header>

        <Card title={<span id="quick-start">Quick start</span>} description="Three requests, from nothing to a CSV of judged results.">
          <ol className="space-y-4 text-sm">
            <Step n={1} title="Create a token">
              Under <Link href="/account/tokens" className="font-semibold text-primary hover:underline">Account → API tokens</Link>. Read-only is enough for everything below. On the demo
              install, the seeded read-only organizer token <code className="font-mono text-xs">dfp_demo-organizer-read-only</code> works too.
            </Step>
            <Step n={2} title="Check who you are">
              <Code>{`curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/auth/me`}</Code>
            </Step>
            <Step n={3} title="Pull data">
              <Code>{`curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/events/sample-hack-2026/projects
curl -H "Authorization: Bearer $TOKEN" -o results.csv http://localhost:8080/api/events/sample-hack-2026/export/results.csv`}</Code>
            </Step>
          </ol>
        </Card>

        <Card>
          <div className="space-y-6">
            {sections.map((s) => {
              const title = s.match(/^## (.+)/)?.[1] ?? "";
              return (
                <section key={title} id={`guide-${anchor(title)}`} className="scroll-mt-24">
                  <Markdown className="text-sm">{s}</Markdown>
                </section>
              );
            })}
          </div>
        </Card>

        <OperationFilter />

        {byTag.map((t) => (
          <section key={t.name} id={anchor(t.name)} data-tag-section className="scroll-mt-24">
            <h2 className="text-xl font-bold">{t.name}</h2>
            <p className="mb-3 mt-0.5 text-sm text-muted">{t.description}</p>
            <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
              {t.ops.map((o) => (
                <Operation key={o.operationId} op={o} />
              ))}
            </div>
          </section>
        ))}

        {spec.webhooks && <WebhookEvents events={spec.webhooks} />}
      </div>
    </div>
  );
}

const VERIFY = `// Node: verify a delivery before trusting it (or use any Standard Webhooks library).
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(secret, headers, rawBody) {
  const id = headers["webhook-id"], ts = Number(headers["webhook-timestamp"]);
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false; // too old: maybe a replay
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const expected = Buffer.from("v1," + createHmac("sha256", key).update(\`\${id}.\${ts}.\${rawBody}\`).digest("base64"));
  return headers["webhook-signature"].split(" ").some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), expected));
}`;

function WebhookEvents({ events }: { events: NonNullable<OpenApiDoc["webhooks"]> }) {
  return (
    <section id="webhook-events" data-tag-section className="scroll-mt-24">
      <h2 className="text-xl font-bold">Webhook events</h2>
      <p className="mb-3 mt-0.5 text-sm text-muted">
        What we POST to your endpoint. Every payload shares the envelope <code className="font-mono text-xs">id</code>, <code className="font-mono text-xs">type</code>,{" "}
        <code className="font-mono text-xs">timestamp</code>, <code className="font-mono text-xs">event</code>; <code className="font-mono text-xs">data</code> depends on the type.
      </p>
      <pre className="mb-4 overflow-x-auto rounded-xl bg-ink px-4 py-3 font-mono text-xs leading-relaxed text-bg">{VERIFY}</pre>
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
        {Object.entries(events).map(([type, e]) => {
          const schema = e.post.requestBody.content["application/json"].schema;
          const data = schema.properties?.data ?? {};
          const rows = schemaRows(data);
          return (
            <details key={type} data-op={`webhook ${type} ${e.post.summary}`.toLowerCase()} className="border-b border-line last:border-b-0">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-surface-2 sm:px-5 [&::-webkit-details-marker]:hidden">
                <span className="inline-flex w-16 shrink-0 justify-center rounded-md border border-accent/25 bg-accent-soft py-0.5 font-mono text-[11px] font-bold uppercase text-accent">event</span>
                <code className="font-mono text-[13px] font-semibold">{type}</code>
                <span className="min-w-0 flex-1 text-sm text-muted">{e.post.summary}</span>
              </summary>
              <div className="border-t border-line bg-bg/40 px-4 py-5 sm:px-5">
                <Block title="data">{rows.length > 0 ? <Table rows={rows} /> : <p className="text-sm text-muted">Empty object.</p>}</Block>
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-bold text-primary">{n}</span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        <div className="mt-1 text-ink-2">{children}</div>
      </div>
    </li>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-1 overflow-x-auto rounded-lg bg-ink px-3 py-2.5 font-mono text-xs leading-relaxed text-bg">{children}</pre>
  );
}

function Method({ method }: { method: string }) {
  return <span className={`inline-flex w-16 shrink-0 justify-center rounded-md border py-0.5 font-mono text-[11px] font-bold uppercase ${METHOD_STYLE[method]}`}>{method}</span>;
}

function Operation({ op }: { op: Op }) {
  const params = op.parameters ?? [];
  const body = op.requestBody && Object.entries(op.requestBody.content)[0];
  const [status, ok] = Object.entries(op.responses)[0]!;
  const okSchema = ok.content && Object.entries(ok.content)[0];
  const errors = Object.entries(op.responses).filter(([code]) => code !== status && code !== "default");
  const needsAuth = op["x-access"] !== "public";
  const example = [
    `curl${op.method === "get" ? "" : ` -X ${op.method.toUpperCase()}`}`,
    needsAuth || op["x-browser-only"] ? (op["x-browser-only"] ? `--cookie "sid=…"` : `-H "Authorization: Bearer $TOKEN"`) : null,
    body && body[0] === "application/json" ? `-H "Content-Type: application/json" -d '{…}'` : null,
    `http://localhost:8080${op.path}`,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <details id={op.operationId} data-op={`${op.method} ${op.path} ${op.summary}`.toLowerCase()} className="group scroll-mt-24 border-b border-line last:border-b-0">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-surface-2 sm:px-5 [&::-webkit-details-marker]:hidden">
        <Method method={op.method} />
        <code className="min-w-0 break-all font-mono text-[13px] font-semibold">{op.path}</code>
        <span className="min-w-0 flex-1 basis-full text-sm text-muted sm:basis-auto">{op.summary}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {op["x-browser-only"] && (
            <Pill tone="warn">
              <Lock className="size-3" /> browser only
            </Pill>
          )}
          <Pill tone={op["x-access"] === "public" ? "success" : "neutral"}>{ACCESS_LABEL[op["x-access"]] ?? op["x-access"]}</Pill>
        </span>
      </summary>
      <div className="space-y-5 border-t border-line bg-bg/40 px-4 py-5 sm:px-5">
        {op.description && <Markdown className="text-sm">{op.description}</Markdown>}

        {params.length > 0 && (
          <Block title="Parameters">
            <Table
              rows={params.map((p) => ({ name: p.name, depth: 0, type: typeLabel(p.schema), required: p.required, notes: [p.in === "query" ? "query" : "path"], description: p.description }))}
            />
          </Block>
        )}

        {body && (
          <Block title={`Request body · ${body[0]}`}>
            {schemaRows(body[1].schema).length > 0 ? <Table rows={schemaRows(body[1].schema)} /> : <p className="text-sm text-muted">Raw bytes.</p>}
          </Block>
        )}

        <Block title={`Response · ${status} ${ok.description}${okSchema ? ` · ${okSchema[0]}` : ""}`}>
          {okSchema && schemaRows(okSchema[1].schema as JsonSchema).length > 0 ? (
            <Table rows={schemaRows(okSchema[1].schema as JsonSchema)} />
          ) : (
            <p className="text-sm text-muted">{okSchema ? (okSchema[0] === "application/json" ? "A JSON object." : "The file.") : "No body."}</p>
          )}
          <ul className="mt-3 flex flex-wrap gap-1.5 text-xs">
            {errors.map(([code, r]) => (
              <li key={code} title={r.description} className="rounded-md border border-line bg-surface px-2 py-0.5 font-mono text-muted">
                {code}
              </li>
            ))}
            <li className="px-1 py-0.5 text-muted">
              errors use the <a href="#guide-conventions" className="font-semibold text-primary hover:underline">standard error shape</a>
            </li>
          </ul>
        </Block>

        <Block title="Example">
          <pre className="overflow-x-auto rounded-lg bg-ink px-3 py-2.5 font-mono text-xs text-bg">{example}</pre>
        </Block>
      </div>
    </details>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">{title}</h4>
      {children}
    </div>
  );
}

function Table({ rows }: { rows: ReturnType<typeof schemaRows> }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full text-left text-sm">
        <tbody className="divide-y divide-line">
          {rows.map((r) => {
            const cut = r.name.lastIndexOf(".");
            return (
              <tr key={r.name} className="align-top">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-[13px]" style={{ paddingLeft: `${0.75 + r.depth * 1}rem` }}>
                  {cut >= 0 && <span className="text-muted">{r.name.slice(0, cut + 1)}</span>}
                  <span className="font-semibold">{r.name.slice(cut + 1)}</span>
                  {r.required && <span className="ml-0.5 text-danger">*</span>}
                </td>
                <td className="px-3 py-2">
                  <code className="font-mono text-xs text-primary">{r.type}</code>
                  {r.notes.length > 0 && <div className="mt-0.5 text-xs text-muted">{r.notes.join(" · ")}</div>}
                </td>
                <td className="min-w-48 px-3 py-2 text-xs text-ink-2">{r.description}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
