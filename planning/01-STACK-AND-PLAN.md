# Stack decision and build plan

Pre-kickoff planning. No project code before **Fri 25 Sep 2026, 18:00 UTC (23:30 IST)**.

## Verdict on MENN (Mongo, Express, Next, Node)

Keep **E, N, N** (TypeScript, strict mode). Replace **M**: use PostgreSQL 16 with Prisma instead of MongoDB.

Why, in order of how much it matters for the score:

1. **The data is relational, and the schema itself is judged.** Code Quality asks "is the schema one a database person would defend?", DATA-MODEL.md is a required document, and the judges are enterprise architects and data people. The domain is built out of many-to-many relationships: judges↔tracks, users↔teams, judges↔projects through assignments, and scores↔criteria. With Mongo you would spend DATA-MODEL.md defending the choice of database instead of the design.
2. **Integrity has to be enforced by the database, not by hoping the app gets it right:**
   - one score per (judge, project, criterion)
   - one team per person per event
   - one live project per team
   - score values within the criterion range
   - no orphaned references

   Postgres gives this through foreign keys, `CHECK` constraints and partial unique indexes. Mongo only offers unique indexes plus application code.
3. **Transactions are needed** for submit-then-audit, assignment batches and publishing results. Mongo transactions need a replica set, even a single-node one. In Docker that means `--replSet` plus an `rs.initiate()` init step, which is a classic way for `docker compose up` to fail on a stranger's laptop. The Adoptability criterion (20%) is lost exactly there.
4. **CSV export, the progress dashboard and normalization input** are joins and GROUP BYs. Plain SQL beats aggregation pipelines for these.
5. **Operational size:** `postgres:16-alpine` is much smaller than the `mongo` image, and `pg_dump` is the migration path every organizer already knows.

You don't need to be strong at SQL. Prisma's schema file reads like TypeScript, it generates migrations for you, and its client is fully typed.

**If the team still insists on Mongo, these are the non-negotiables:**
- a single-node replica set with a healthchecked init container
- `$jsonSchema` validators on every collection
- unique compound indexes for every invariant listed below
- a section in DATA-MODEL.md defending the choice

**The other real option is Django + DRF + Postgres.** You get auth, sessions, an admin, migrations and server-rendered templates for free. Pick it only if most of the team is stronger in Django than in TypeScript.

## Architecture (one command, fully offline)

```
docker compose up
 ├─ gateway   nginx:alpine on :8080     /api/* → api:4000,  /* → web:3000
 ├─ web       Next.js (App Router, SSR) — a pure client of the API, holds no DB credentials
 ├─ api       Express + TypeScript + zod — every rule and every permission check lives here
 │            on boot: prisma migrate deploy → idempotent fixture seed → prints test logins
 ├─ db        postgres:16-alpine (named volume, healthcheck)
 └─ mail      mailpit (offline SMTP catcher; invite links readable at :8025)
```

**The headline decision (Architecture / Innovation):** the web UI talks to the backend only through the public REST API. So "every UI action is available in the API" (T4, plus the API First bonus) is true by construction, and role checks physically cannot live only in the frontend. zod schemas → `@asteasolutions/zod-to-openapi` → a served `openapi.json` plus a docs page.

### Offline gotchas to design around from hour 0
- **No `next/font/google`**, because it fetches at build time. Use system fonts or `next/font/local`.
- **No CDN scripts, images, or avatars** (gravatar and similar).
- Set `NEXT_TELEMETRY_DISABLED=1`, and turn off Prisma telemetry.
- **Prisma on Alpine needs the correct `binaryTargets`.** Use `node:22-bookworm-slim` for `api`/`web` to avoid OpenSSL trouble.
- **Email never leaves the box.** Everything goes to Mailpit, and the dev UI also shows invite links inline.
- **Ask on Discord:** is the network-off test run *after* images are built or pulled? `npm ci` and `docker pull` need a network once. Document this in the README either way.

## Checker contract (make all 7 pass by hour 12)

| Key | Route | Notes |
|---|---|---|
| gallery | `/events/sample-hack-2026/projects` | **SSR**, so titles are in the raw HTML. Page 1 must include "Glass Signal", "Small Meadow" or "Deep Compass" (page size ≥ 50, or a default sort that puts them first). |
| submit | `/api/events/sample-hack-2026/projects` | Check order: authenticate → load event → **deadline** → membership → validate. Refuse with `403 {code:"submissions_closed"}` and audit-log the attempt. |
| judge_scores | `/api/events/sample-hack-2026/judges/me/scores` | |
| peer_scores | `/api/events/sample-hack-2026/judges/jdg_24/scores` | Visited as judge_b (jdg_26). The two share 5 projects and both cover trk_01, so **only** peer isolation stops it, and the test is meaningful. |
| csv_export | `/api/events/sample-hack-2026/export/results.csv` | |

- **Auth:** seed rows in the `Session` table with known tokens (store only SHA-256 hashes), and print them at boot:
  - organizer: `Cookie: sid=seed-organizer`
  - judge_a = jdg_24 (Diego Herrera)
  - judge_b = jdg_26 (Jonas Vogel)
  - participant = priya1@example.org (team tm_01)
- **Seeded sessions must be switchable off** with `SEED_DEMO_SESSIONS=false`. That's the answer to "is this production-safe?"

**Tier claim:** `run.py` has no T3 or T4 checks, and verification stops at the first tier with no checks. Put `claimed = ["T1","T2"]` in `.dogfood.toml`, and document T4 in the README as "built, shown in the demo, not covered by run.py". Ask on Discord how they want T4-without-T3 claimed. Claiming T4 as-is prints `claimed but not verified`.

**Cheap T3 items worth considering anyway** (they feed Judging Integrity): the audit log (needed for T2/T4 anyway), rate limiting (one middleware), and randomized ordering with a per-viewer seed.

## Team split (3–4 people)

| Owner | Scope |
|---|---|
| A: platform | docker-compose, gateway, Prisma schema and migrations, fixture importer/seed, auth and sessions, **the policy layer** (`can(actor, action, resource)`), audit log, CI running run.py |
| B: participant flow | events, tracks, prizes, teams and invite links, submissions (draft→submitted, edit until deadline), gallery search/filter, SSR pages |
| C: judging | rubric builder, judge invites, assignment algorithm, judge console, organizer progress dashboard, normalization, CSV exports, results publishing |
| D: T4 + docs | OpenAPI, webhooks (outbox + worker), signed judge records (Ed25519 via `node:crypto`), certificates, embed widget, bulk import/export, README / ARCHITECTURE / DATA-MODEL |

With 3 people, merge D into A and C.

## Milestones (IST; kickoff Fri 23:30)

Build first, paperwork last. Order: **T1 → T2 (polished) → T3 → T4**.

| When | Milestone |
|---|---|
| H+4 (Sat 03:30) | Compose boots, schema migrated, fixtures seeded, login works |
| H+30 (Sun 05:30) | T1 done and solid |
| H+42 (Sun 17:30) | T2 done and solid, normalization included |
| H+42 → H+62 | T3, then T4, as far as time allows |
| H+62–72 | Docs, .dogfood.toml, acceptance report, demo video |
| **H+72 (Mon 23:30)** | Code freeze |
