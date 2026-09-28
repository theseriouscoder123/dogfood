// A tiny webhook receiver for the demo (the "hooks" service in docker-compose.yml), and a
// reference for integrators: it verifies every delivery the way a real receiver should.
//
//   POST /hooks/ok     verify, record, answer 204
//   POST /hooks/down   always 503, to show retries and backoff
//   GET  /             the last 50 deliveries received, newest first
import { createServer } from "node:http";
import { verifyWebhook } from "../webhooks/signature";

const PORT = Number(process.env.PORT ?? 9000);
const SECRET = process.env.WEBHOOK_SECRET ?? "";

type Received = { at: string; path: string; id: string; type: string; event: string; verified: string; body: string };
const received: Received[] = [];
const seen = new Set<string>();

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function page(): string {
  const rows = received
    .map(
      (r) => `<tr><td>${esc(r.at.slice(11, 19))}</td><td><code>${esc(r.type)}</code></td><td>${esc(r.event)}</td><td><code>${esc(r.id)}</code></td><td class="${r.verified.startsWith("✓") ? "ok" : "bad"}">${esc(r.verified)}</td>
        <td><details><summary>payload</summary><pre>${esc(r.body)}</pre></details></td></tr>`,
    )
    .join("");
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="3"><title>Webhook receiver</title>
<style>body{font:14px system-ui;margin:2rem;color:#1f2933}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #e4e7eb;padding:.45rem .6rem;text-align:left;vertical-align:top}
.ok{color:#15803d;font-weight:600}.bad{color:#b91c1c;font-weight:600}pre{background:#f5f7fa;padding:.6rem;border-radius:6px;max-width:60ch;overflow:auto}code{font-size:12px}</style>
<h1>Demo webhook receiver</h1><p>Verifies every delivery with the shared secret (Standard Webhooks). Refreshes every 3 seconds. ${received.length} received.</p>
<table><tr><th>UTC</th><th>Type</th><th>Event</th><th>Message id</th><th>Signature</th><th></th></tr>${rows || '<tr><td colspan="6">Nothing yet. Submit a project, or press "Send test" on the webhook page.</td></tr>'}</table>`;
}

createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(page());
    return;
  }
  if (req.method !== "POST" || !req.url?.startsWith("/hooks/")) {
    res.writeHead(404).end();
    return;
  }
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    if (req.url === "/hooks/down") {
      res.writeHead(503).end("down for maintenance");
      return;
    }
    const body = Buffer.concat(chunks).toString("utf8");
    const check = SECRET ? verifyWebhook(SECRET, req.headers, body) : { ok: false as const, reason: "no WEBHOOK_SECRET configured" };
    const id = String(req.headers["webhook-id"] ?? "");
    const duplicate = seen.has(id);
    seen.add(id);
    let parsed: { type?: string; event?: { name?: string } } = {};
    try {
      parsed = JSON.parse(body);
    } catch {
      /* recorded as-is below */
    }
    received.unshift({
      at: new Date().toISOString(),
      path: req.url ?? "",
      id,
      type: parsed.type ?? "?",
      event: parsed.event?.name ?? "?",
      verified: check.ok ? (duplicate ? "✓ valid (duplicate id)" : "✓ valid") : `✗ ${check.reason}`,
      body: parsed.type ? JSON.stringify(parsed, null, 2) : body,
    });
    received.length = Math.min(received.length, 50);
    console.log(`${check.ok ? "verified" : "REJECTED"} ${parsed.type} ${id}`);
    // A real receiver would refuse unverified requests; the demo records them so the failure is visible.
    res.writeHead(check.ok ? 204 : 401).end();
  });
}).listen(PORT, () => console.log(`webhook receiver on :${PORT}`));
