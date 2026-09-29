// Captures the README screenshots from a running portal (docker compose up), using headless
// Chrome over the DevTools protocol and the seeded demo sessions. Node 22+, no packages.
//   node tools/screenshots.mjs docs/screenshots
//   CHROME=/path/to/chrome ONLY=05 node tools/screenshots.mjs docs/screenshots
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUT = process.argv[2] ?? "docs/screenshots";
mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:8080";
const CHROME = process.env.CHROME ?? (process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome");
const PORT = 9333;
const W = 1440, H = 900;

const api = async (path, sid) => (await fetch(BASE + path, { headers: { cookie: `sid=${sid}` } })).json();
const judging = await api("/api/events/spring-build-sprint/judging", "seed-judge-demo");
const draft = judging.assignments.find((a) => a.status === "in_progress") ?? judging.assignments.find((a) => a.status === "assigned");
const priya = await api("/api/users/priya", "seed-participant");
const certId = priya.certificates?.[0]?.id;

// [file, url, sid, view cookie, scrollY, full page?]
const SHOTS = [
  ["01-results-public.png", "/events/sample-hack-2026/results", null, null, 330],
  ["02-dashboard-organizer.png", "/dashboard", "seed-organizer", "organizer", 0],
  ["03-judge-scoring.png", `/events/spring-build-sprint/judging/${draft.id}`, "seed-judge-demo", "judge", 0],
  ["04-results-adjusted.png", "/events/sample-hack-2026/manage/results", "seed-organizer", "organizer", 620],
  ["05-integrity.png", "/events/spring-build-sprint/manage/integrity", "seed-organizer", "organizer", 0],
  ["06-head-to-head.png", "/events/spring-build-sprint/manage/pairwise", "seed-organizer", "organizer", 0],
  ["07-vote-review.png", "/events/spring-build-sprint/manage/vote-review", "seed-organizer", "organizer", 0],
  ["08-verify-certificate.png", `/verify/${certId}`, null, null, 0],
  ["09-progress.png", "/events/spring-build-sprint/manage/progress", "seed-organizer", "organizer", 0],
];

const profile = mkdtempSync(join(tmpdir(), "shots-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--hide-scrollbars", "--no-first-run", `--window-size=${W},${H}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets.length) break; } catch {}
  await sleep(200);
}
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
const waiters = [];
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  else if (msg.method) for (const w of [...waiters]) if (w.method === msg.method) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id; pending.set(n, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
  ws.send(JSON.stringify({ id: n, method, params }));
});
const once = (method) => new Promise((resolve) => waiters.push({ method, resolve }));

await send("Page.enable");
await send("Network.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });

for (const [file, path, sid, view, scrollY] of SHOTS.filter((s) => !process.env.ONLY || s[0].startsWith(process.env.ONLY))) {
  await send("Network.clearBrowserCookies");
  if (sid) await send("Network.setCookie", { name: "sid", value: sid, domain: "localhost", path: "/" });
  if (view) await send("Network.setCookie", { name: "dogfood-view", value: view, domain: "localhost", path: "/" });
  const loaded = once("Page.loadEventFired");
  await send("Page.navigate", { url: BASE + path });
  await loaded;
  await sleep(2500); // client data and fonts
  if (scrollY) { await send("Runtime.evaluate", { expression: `window.scrollTo(0, ${scrollY})` }); await sleep(500); }
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, file), Buffer.from(data, "base64"));
  console.log("saved", file, path);
}
ws.close();
chrome.kill();
