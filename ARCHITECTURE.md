# Architecture

Two TypeScript apps behind one gateway, with one PostgreSQL database. **Everything that decides anything lives in the API; the web app only renders.** The web app has no database access and uses the same documented HTTP API as any script.

## Services

`docker-compose.yml` starts six containers. Only the gateway listens on all interfaces; the others publish nothing, or only to `127.0.0.1`.

```
                        browser, scripts, embeds
                                  │  :8080
                            ┌─────▼─────┐
                            │  gateway  │  nginx 1.29
                            └──┬─────┬──┘
                   /api/*      │     │    everything else
                   ┌───────────▼┐   ┌▼────────────┐
                   │    api     │◄──┤     web     │  Next.js 15: server-rendered pages call the
                   │ Express 5  │   │  (React 19) │  API directly at http://api:4000, with the
                   └─┬───┬───┬──┘   └─────────────┘  visitor's own cookie
         Postgres 16 │   │   │ SMTP
         ┌───────────▼┐  │  ┌▼──────────┐
         │     db     │  │  │   mail    │  Mailpit (demo): catches every email, UI on :8025
         └────────────┘  │  └───────────┘
                         │ signed HTTP POSTs
                   ┌─────▼─────┐
                   │   hooks   │  demo webhook receiver on :9000 (delete it for a real event)
                   └───────────┘
```

| Container | Image | Role | Published |
|---|---|---|---|
| `gateway` | nginx:1.29-alpine | One origin: `/api/*` goes to the API, everything else to the web app. 26 MB body limit (event import) | `8080` |
| `web` | `apps/web` (Node 22, runs as `node`) | Server-rendered pages. Holds no state | none |
| `api` | `apps/api` (Node 22, runs as `node`) | Every rule, every write, and the background jobs | none |
| `db` | postgres:16-alpine | All data | `127.0.0.1:5433` |
| `mail` | axllent/mailpit | Demo SMTP sink | `127.0.0.1:8025`, `127.0.0.1:1025` |
| `hooks` | API image, another command | Demo webhook receiver | `127.0.0.1:9000` |

**Volumes:**
- `pgdata`: the database;
- `uploads`: content-addressed images;
- `keys`: the Ed25519 signing key, mode 0600, on its own volume so it can be backed up and protected separately.

**Start-up** (`apps/api/docker-entrypoint.sh`):
1. `prisma migrate deploy`, which only moves forward;
2. the idempotent seed;
3. serve.

Binaries are called directly, not through `npx`, so nothing reaches for the npm registry at runtime. Once built, the stack runs with no internet at all: `tools/offline-check.compose.yml` puts every service except the gateway on a network with no route out, and the checker still passes.

## Inside the API

```
request ─► request id ─► cookie parser ─► loadActor ─► router ─► zod parse ─► policy.decide*() ─► prisma $transaction
                                          (session cookie                          │                    │
                                           or Bearer token)                        │         appendAudit(tx, …)
                                                                                   │           ├─ hash chain row
                                                                          403/404/409 etc.     ├─ webhook outbox rows
                                                                                               └─ notifications
```

- **Routers** (`src/routes/*.ts`) are mounted from two tables in `src/app.ts`: `MOUNTS` and `RAW_BODY_MOUNTS` (for event import, which takes up to 25 MB of JSON). A unit test walks both tables and fails if any mounted route is missing from the OpenAPI catalogue, or vice versa.
- **Input.** Every body and query is parsed with a zod schema. The same schema objects generate the OpenAPI document (`src/openapi/`), so the documented contract is the enforced one.
- **Permissions.** Routes never compare roles. They ask `src/policy.ts` (`decideScore`, `decideOrganize`, `decideEditProject`, …), which returns an outcome that the route enforces. The policy is a pure function of (actor, roles in this event, time window, resource), unit-tested as a table and tested end to end by the access matrix.
- **Hiding what isn't yours.** Queries for a judge's work filter on `judgeId = caller`, so another judge's assignment is a 404, not a 403. Private drafts behave the same way for outsiders.
- **One transaction per change.** A write, its audit row, its webhook outbox rows and its notifications commit or roll back together. Nobody is notified about something that didn't happen.
- **Errors** are JSON `{ error: { code, message, details? } }`. The web app shows `message`; scripts switch on `code`.

### The audit log is also the event stream

`appendAudit(tx, entry)` (`src/audit.ts`):
- takes a transaction-scoped advisory lock;
- reads the last hash;
- writes `hash = sha256(prevHash + canonicalJson(row))`.

Database triggers refuse UPDATE, DELETE and TRUNCATE on the table. Two things hang off the same call:
- **`enqueueForAudit`** turns audited actions into webhook deliveries, for endpoints subscribed to that event type (21 types; ballots are never among them);
- **`notifyForAudit`** turns them into in-portal notifications (and an email flag for the categories people want emailed).

This is why there's no separate event bus: if it's audited, it can be published, and it can't be published without being audited.

**Trade-off:** the advisory lock serializes audited writes across the whole portal. That's fine at hackathon scale (dozens of writes a second), but it's the first thing to revisit for a much larger deployment.

### Authentication

- **Browser sessions.** A random token goes in an `httpOnly`, `SameSite=Lax` cookie (`Secure` when `COOKIE_SECURE=true`); only its SHA-256 is stored. They last 30 days by default. Changing your password signs out your other sessions.
- **Passwords:** scrypt (N = 16384, r = 8, p = 1, 16-byte salt), compared in constant time.
- **Failed sign-ins** are limited to 10 per account and 50 per network in 15 minutes; after that, 429 with `Retry-After`.
- **Email links:** one-time sign-in links (30 minutes) and password links (1 hour, or 7 days for a judge invitation). Following one proves the address.
  - Someone who was invited, or imported, has no password until they set one through such a link.
  - Registering with their address doesn't sign anyone in; it only emails them.
- **API tokens:** `dfp_` plus 32 random bytes, stored as SHA-256. Scopes are `read` or `read`+`write`; tokens have an optional expiry and can be revoked. Each token is rate-limited to 600 requests a minute, with `RateLimit-*` headers.
  - Some actions need a person at a browser and refuse tokens: managing tokens, voting, commenting and changing a password.
- **Client address.** `TRUST_PROXY` hops are believed (default 1: the gateway). A client can't forge the address that the vote, sign-in link and login limits use.

### Background jobs

These run inside the API process (`src/index.ts`), unless `WEBHOOK_WORKER=false`:

| Job | Every | What it does |
|---|---|---|
| Webhook worker | 2 s | Claims due deliveries with `FOR UPDATE SKIP LOCKED`, in 4 parallel lanes, and POSTs them. Timeout, no redirects. SSRF check at send time. Retries after 1 min, 5 min, 30 min, 2 h, 6 h, 12 h and 24 h (8 attempts in about 45 h, with jitter). An endpoint is switched off after 5+ failures in a row lasting 24 h, or at once on `410 Gone`, and organizers are notified |
| Deadline reminders | 60 s | 24 h and 1 h before submissions close, to teams with nothing submitted; 24 h before judging closes, to judges with work left. A unique key per (reminder, event, person) means once each |
| Organizer alerts | 60 s | A judge who has fallen behind (the Progress page's rule), and open high-severity vote incidents. Once each |
| Notification email | 5 s | Sends up to 20 queued notification emails per run |

## Inside the web app

- **Pages are React Server Components.** They call `api()` (`src/lib/api.ts`), which forwards the visitor's cookie to `http://api:4000`. The API's permission checks therefore apply to every page, and a page can never show more than the API would give that person.
- **Interactive parts** are small client components that call `/api/*` on the same origin through the gateway (`src/lib/client.ts`). They use toasts and in-app dialogs instead of `alert` and `confirm`.
- **Framing.** Every route sends `X-Frame-Options: DENY` and `frame-ancestors 'none'`, except `/embed/*`, which allows framing. Middleware marks embed requests so the root layout renders them bare: no header or footer, and no session lookup. An embed shows the same thing to everyone.
- **Look.** Tailwind 4 with design tokens in `globals.css`. Light and dark follow the OS, with a toggle. Fonts are bundled with `@fontsource`, not loaded from a CDN.

## Judging engine

Pure modules under `apps/api/src/judging/`, with no I/O, each unit-tested:

| Module | Does |
|---|---|
| `composite.ts` | Rubric → one 1–5 number per review |
| `assign.ts` | Deterministic, constraint-safe, balanced judge assignment |
| `normalize.ts` | Additive judge-effect model with ridge shrinkage; rank uncertainty; shared ranks for ties |
| `integrity.ts` | Review integrity flags and inter-rater reliability |
| `results.ts` | Stored reviews → a ranked, fingerprinted result run |
| `pairwise.ts` | Bradley–Terry fit, head-to-head pair selection, bias and agreement analysis |
| `progress.ts` | Judge pace ("behind", "not started") |
| `proof.ts` | The simulation behind `docs/normalization-proof.md` |

The method and evidence are in [JUDGING.md](JUDGING.md).

## Signed records

`src/records/`: judge participation records and participant certificates.
- **Signing.** Each is a canonical JSON statement, signed with Ed25519. The private key is a PEM file created on first use; public keys are kept in `SigningKey` by key id, so old records still verify after a key change.
- **Protection.** Records are append-only (a trigger), revocable, and superseded rather than edited.
- **Verification.** `/verify/<id>` verifies in the browser with WebCrypto, and `tools/verify-record.mjs` verifies with Node alone (no packages), fetching the public key from the issuer.

## Configuration

Everything is an environment variable on the `api` service; `apps/api/src/config.ts` is the full list with comments. The ones that matter for a real event are in the [README](README.md#running-it-for-a-real-event).

## Tests

| Suite | Where | What |
|---|---|---|
| Unit | `apps/api/tests/unit` | Policy table, judging maths (normalization, assignment, integrity, pairwise, progress), voting helpers, CSV, signatures and retries, OpenAPI drift. No database |
| Integration | `apps/api/tests/integration` | The real Express app against a real Postgres. Each run creates a throwaway database, migrates it and drops it afterwards. Covers every tier, plus the access matrix |
| Checker | `python3 run.py .dogfood.toml` | The organizers' T1 and T2 acceptance checks |
| Manual | `planning/TEST-PLAN.md`, `planning/TEST-PLAN-2.md` | Click-through plans for the UI, including light, dark and phone widths |

## Decisions, and what they cost

- **Postgres constraints over code-only rules.** The rules that must hold whatever happens (score ranges, ballot limits, append-only logs and records, "a review matches its assignment") are CHECKs, composite foreign keys and triggers, listed in [DATA-MODEL.md](DATA-MODEL.md#8-rules-the-database-enforces-itself). The cost is hand-written SQL in migrations.
- **Server-rendered pages calling the public API.** There's one permission model and no second data path. The cost is an extra hop per page render, which is negligible here.
- **Outbox in the same transaction** rather than a message broker. Nothing extra to run, and nothing is lost or phantom. The cost is that the worker polls every 2 s.
- **In-memory rate limiters** (tokens and sign-ins). Right for one API process, but they reset on restart and aren't shared between replicas.
- **One API process runs the jobs.** Simple, but more than one replica is untested.
