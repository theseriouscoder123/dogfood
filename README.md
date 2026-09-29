# Verdict

A self-hostable hackathon platform: registration, teams, submissions, judging, community voting, results and certificates, in one `docker compose up`.

It was built for DOGFOOD 2026 and focuses on the part most tools get wrong: **judging you can defend**. (The repository, config files, demo accounts and event slugs keep the working name `dogfood`.)
- Judges can't see each other's work, and the API enforces that, not the page.
- Scores are adjusted for harsh and generous judges, using a documented, tested model.
- Every change goes into a hash-chained audit log.
- Results, judge records and certificates are Ed25519-signed, so anyone can verify them without trusting the server.

Tiers claimed: **T1, T2, T3 and T4**. The official checker verifies T1 and T2 ([acceptance-report.txt](acceptance-report.txt)); T3 and T4 have no automated checks, so [the tier table](#whats-built-tier-by-tier) below shows how to see each one yourself.

![Results for the fixture event: each project's raw average beside its adjusted score, rank movement and a likely-rank range](docs/screenshots/04-results-adjusted.png)

---

## Quick start

You need Docker (with Compose v2) and nothing else.

```bash
docker compose up
```

- **Timing:** the first build takes about 3 minutes (it installs npm packages). After that, a boot takes about 25 seconds.
- **What starts:**
  - migrations run;
  - the fixture event is imported;
  - demo content is seeded;
  - the API prints the test logins.
- **Where to go:**

| Open | What it is |
|---|---|
| http://localhost:8080 | The portal |
| http://localhost:8025 | Mailpit: every email the portal sends (invites, sign-in links, notifications) lands here |
| http://localhost:9000 | A demo webhook receiver that verifies signatures and lists what arrived |

- **Running the checker:**

```bash
python3 run.py .dogfood.toml
```

- **No internet needed at runtime.** Once the images are built, nothing calls out: fonts are bundled, and there are no CDNs, cloud APIs or telemetry. To check that yourself, run the stack on a network with no route out:

```bash
docker compose -f docker-compose.yml -f tools/offline-check.compose.yml up -d
```

We ran exactly that on a fresh clone. The checker passed 7/7 and every page loaded; the API container can't even resolve DNS.

- **Starting over:** `docker compose down -v` wipes everything.

### Test logins

Every seeded account's password is `dogfood2026`. The API also prints fixed session cookies at boot, for curl and for the checker.

| Who | Email | Header |
|---|---|---|
| Organizer (all three demo events) | organizer@dogfood.local | `Cookie: sid=seed-organizer` |
| Judge A: Diego Herrera, fixture `jdg_24` | diego.herrera@example.org | `Cookie: sid=seed-judge-a` |
| Judge B: Jonas Vogel, fixture `jdg_26` | jonas.vogel@example.org | `Cookie: sid=seed-judge-b` |
| Participant: Priya, team NorthKiln | priya1@example.org | `Cookie: sid=seed-participant` |
| Judge with work left, Spring Build Sprint | judge@dogfood.local | `Cookie: sid=seed-judge-demo` |
| Voter with a verified email | voter@dogfood.local | `Cookie: sid=seed-voter` |
| Portal admin | admin@dogfood.local | `Cookie: sid=seed-admin` |
| Read-only API token (organizer) | | `Authorization: Bearer dfp_demo-organizer-read-only` |

### Three demo events

- **Sample Hack 2026** (`sample-hack-2026`). The official fixture: 40 projects (plus 1 flagged duplicate), 30 judges and 8 tracks. Judging is over, results and People's Choice are published, and certificates are signed.
- **Spring Build Sprint** (`spring-build-sprint`). Frozen halfway through judging:
  - judges who are behind, a recusal, and drafts in flight;
  - a generous judge, a harsh one and a flat one;
  - an open community vote with a planted ballot-stuffing ring;
  - head-to-head judging, including a planted contrarian judge.
- **Dogfood Demo Jam** (`dogfood-demo-jam`). Open for submissions, with announcements and people looking for teams.

---

## A five-minute tour

Roles are per event, so one account can build in one hackathon and judge another. Anyone with more than one role gets a **view switcher** in the header (Participant, Judge, Organizer). The dashboard, the header links and the event tabs then show only that role's work. The switcher changes what's shown, never what's allowed: the API checks permissions the same way in every view.

**Participant** (Priya):
1. The Dashboard shows her team, her project and upcoming deadlines.
2. On Dogfood Demo Jam, look through **Find a team**, press **Register now**, then use **My team** to create a team, copy an invite link and start a draft.
3. Drafts are private. A project can be edited until the deadline, and after that the API refuses edits.
4. Her profile at `/u/priya` shows her hackathon history and her signed certificate.

**Judge** (`judge@dogfood.local`), on Spring Build Sprint:
1. Open **Judging** for your queue.
2. Scoring works from the keyboard: number keys score, ↑ ↓ move between criteria, and drafts save automatically.
3. **Head to head** asks which of two of your projects is stronger.
4. You never see another judge's scores. The API returns 403 or 404, not a hidden button.

**Organizer**, on Spring Build Sprint's **Manage** pages:
- **Progress:** live completion, who is behind (with reminders), and projects at risk.
- **Integrity:** flagged reviews (outliers, rushed reviews, comments that contradict the score, judges against the panel) and the reliability estimate.
- **Results:**
  - the adjusted ranking next to the raw one;
  - each judge's measured leniency;
  - a 90% rank range for every project;
  - immutable runs, which can only be published after judging closes.
- **Head to head:** the Bradley–Terry ranking, its agreement with the rubric, projects the two methods disagree on, and position bias.
- **Vote review:** a stuffing ring grouped into one high-severity incident. Quarantining its ballots is audited.
- **Webhooks:** add a Slack, Discord or signed JSON endpoint, send a test, read the delivery log.

**Anyone:**
- `/developers` has the full API reference and the webhook event catalogue.
- `/verify/<id>` checks a certificate's signature in your browser.
- `node tools/verify-record.mjs <link>` checks one offline, with no dependencies.

## Screenshots

Taken from a fresh `docker compose up`, in dark mode. Light mode and phone widths work too. To retake them: `node tools/screenshots.mjs` (Node 22 and Chrome, with the stack running).

<table>
<tr>
<td width="50%"><img src="docs/screenshots/01-results-public.png" alt="Public results page with the podium"><br><b>Public results.</b> The podium and full ranking, visible once judging has closed and results are published.</td>
<td width="50%"><img src="docs/screenshots/02-dashboard-organizer.png" alt="Organizer dashboard in Organizer view"><br><b>Organizer view.</b> The switcher in the header shows one role's work at a time.</td>
</tr>
<tr>
<td><img src="docs/screenshots/03-judge-scoring.png" alt="Judge scoring a project against the weighted rubric"><br><b>Judging.</b> A weighted rubric, scored from the keyboard, with drafts saved as you go.</td>
<td><img src="docs/screenshots/09-progress.png" alt="Judging progress with judges behind and a pace chart"><br><b>Progress.</b> Reviews against a steady pace, who's behind, and reminders.</td>
</tr>
<tr>
<td><img src="docs/screenshots/05-integrity.png" alt="Integrity page with flags and the low-agreement warning"><br><b>Integrity.</b> Flags for a person to decide, and an honest warning when judges barely agree.</td>
<td><img src="docs/screenshots/06-head-to-head.png" alt="Head-to-head ranking beside the rubric rank"><br><b>Head to head.</b> A Bradley–Terry ranking with rank ranges, checked against the rubric.</td>
</tr>
<tr>
<td><img src="docs/screenshots/07-vote-review.png" alt="Vote review showing a ballot-stuffing incident"><br><b>Vote review.</b> A planted stuffing ring, grouped into one incident with its evidence.</td>
<td><img src="docs/screenshots/08-verify-certificate.png" alt="Certificate verification page"><br><b>Verify a certificate.</b> The signature is re-checked in the visitor's own browser.</td>
</tr>
</table>

---

## What's built, tier by tier

"Proof" names the automated test that exercises each requirement. It's in `apps/api/tests/` unless noted. Everything below was also checked by hand against a fresh `docker compose up`.

### T1 core

| Requirement | Where | Proof |
|---|---|---|
| Login and roles | Email and password (failed attempts throttled), magic links, sessions. A role is per event (participant, judge, organizer), plus portal admin | `unit/policy.test.ts`, `integration/access-matrix.test.ts` |
| Create an event | **Host a hackathon**: a five-step wizard. Events are private drafts until published | `integration/hosting.test.ts` |
| Form a team | Create a team, invite by link or email, team-size cap enforced under a row lock | `integration/core.test.ts` |
| Submit, edit until the deadline | Drafts are private; submit needs the required fields; editable after submitting | `integration/core.test.ts` |
| The deadline stops submissions | Server clock. New projects, edits and status changes are all refused and logged as `submission.refused_closed` | `integration/core.test.ts`, checker T1 #3 |
| Public gallery | `/events/<slug>/projects`, server-rendered, no sign-in | checker T1 #1–2 |

### T2 judging

| Requirement | Where | Proof |
|---|---|---|
| Invite and assign judges | Invite by email, tracks per judge, conflicts of interest. Auto-assign previews a deterministic, balanced plan before committing | `integration/judging-setup.test.ts`, `integration/assignments.test.ts`, `unit/assign.test.ts` |
| Weighted rubric | Criteria with weights and scales. Once anyone has scored, the structure freezes; weights stay editable | `integration/judging-setup.test.ts` |
| Judges can't see each other's work | Every judge query filters on the caller. Another judge's assignment is a 404 and their scores a 403 | `integration/judge-console.test.ts`, `integration/access-matrix.test.ts`, checker T2 #2 |
| Organizer progress view | Manage → Progress | `integration/progress-exports.test.ts` |
| Documented way to even out harsh and generous judges | An additive judge-effect model with ridge shrinkage. It beats raw averages and z-scores in simulation on this event's real graph | [JUDGING.md](JUDGING.md), [docs/normalization-proof.md](docs/normalization-proof.md), `unit/normalize.test.ts` |
| CSV export | 11 CSVs covering every stage, plus a full JSON export. Each download is audited | `integration/progress-exports.test.ts`, checker T2 #4 |

### T3 public

| Requirement | Where | Proof |
|---|---|---|
| Community voting | Three voter modes (verified email, account, ballot codes). You can change your vote until the close. Receipts | `integration/voting.test.ts` |
| Comments | One level of replies, reports, organizer moderation, spam guards | `integration/comments.test.ts` |
| Results hidden until the window closes | Judging results can only be published after judging closes. People's Choice stays sealed while voting is open, even to organizers | `integration/results.test.ts`, `integration/voting-results.test.ts` |
| Ballots in random order | A per-voter seeded shuffle: stable for one voter, different between voters | `unit/voting.test.ts`, `unit/tally.test.ts` |
| An answer to cheating | Throwaway inboxes refused, rate limits, "voted without looking" detection, incidents grouped for review, audited quarantine | `integration/vote-abuse.test.ts`, `unit/abuse.test.ts` |

### T4 stretch

| Requirement | Where | Proof |
|---|---|---|
| REST API | 162 documented operations; OpenAPI 3.1 at `/api/openapi.json` and `docs/openapi.json`; personal API tokens with read/write scopes | `unit/openapi.test.ts` (the spec must match the mounted routes), `integration/api-tokens.test.ts` |
| Webhooks | 21 event types, a transactional outbox, Standard Webhooks signatures, retries with backoff, auto-disable, SSRF guard, Slack and Discord formats | `integration/webhooks.test.ts`, `unit/webhooks.test.ts` |
| Certificates and verifiable judge records | Ed25519-signed statements, append-only in the DB, revocable, checked in the browser or offline | `integration/records.test.ts`, `tools/verify-record.mjs` |
| Embeddable gallery | `/embed/<slug>` plus a one-line `embed.js`. Always anonymous, and the only route that allows framing | Checked by hand (no automated test): its headers, and identical output for anonymous and signed-in visitors |
| Bulk import and export | A `dogfood-event/v1` JSON file. Import checks everything and reports every problem at once, and has a dry-run mode | `integration/portability.test.ts` |

### Bonus challenges

- **Normalization proof:** [docs/normalization-proof.md](docs/normalization-proof.md). Regenerate it with `npm run judging:proof`; it's deterministic.
- **Pairwise judging mode:** head-to-head comparisons ranked with Bradley–Terry, beside the rubric. See [JUDGING.md](JUDGING.md#8-head-to-head).
- **Threat model:** [THREAT-MODEL.md](THREAT-MODEL.md).
- **API-first:** the web app uses the same documented API as scripts do.

---

## How judging works, briefly

Each review becomes one weighted score from 1 to 5. The model is:

`score = overall mean + project quality + judge leniency + noise`

- **Fitting:** it's fitted with shrinkage, so a judge with three reviews isn't over-corrected. A judge's leniency is learned from the projects they share with other judges, and then removed.
- **Uncertainty:** every project gets a 90% rank range, and ties are shared ("5, 5, 7").
- **Integrity checks** flag reviews for a human to look at; they never change a score.
- **Head to head:** optional pairwise comparisons give a second, scale-free ranking to check against.

The details, the evidence and the limits are in [JUDGING.md](JUDGING.md).

## Security, briefly

- **Permissions live in one module** (`apps/api/src/policy.ts`) and are enforced by the API.
- **Tested from the outside:** an integration test calls every documented route (more than 600 calls) as every kind of person who should be refused. It checks that each call is refused and that nothing changed.
- **Found while writing it up:** checking every threat-model claim against the running system turned up four real problems, all fixed with regression tests before submission:
  - a forgeable client IP;
  - no limit on password guessing;
  - account takeover of invited judges through registration;
  - the viewer's name inside the embed's HTML.
- **Honest limits:** the threat model covers what we defend against and what we don't. See [THREAT-MODEL.md](THREAT-MODEL.md).

---

## Running it for a real event

The defaults are for a demo. For a real event, change these in `docker-compose.yml` (under `api:` unless noted):

| Setting | Why |
|---|---|
| `SEED_FIXTURES=false` | Start empty: no sample events, no demo people. Only the admin account is created |
| `SEED_DEMO=false` | Remove the fixed demo sessions, the demo API token and the demo webhooks |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | The first admin. Set on every start, so this is also how you reset a lost admin password |
| `PUBLIC_BASE_URL` | The address people use (for email links, webhooks and signed records), e.g. `https://hack.example.org` |
| `COOKIE_SECURE=true` | When you serve over HTTPS (you should) |
| `SMTP_URL`, `MAIL_FROM` | Your mail server, e.g. `smtps://user:pass@smtp.example.org`. The demo sends to Mailpit |
| `HOSTING=admins` | Only admins may create hackathons. By default, any signed-in user can host a draft |
| `TRUST_PROXY` | How many proxies in front of the API may set `X-Forwarded-For`. Default 1 (the gateway). Add one for each proxy you put in front, so vote and sign-in limits see real client addresses |
| `WEBHOOK_ALLOW_PRIVATE_HOSTS` | Leave it empty: webhooks may then only reach public addresses. Also delete the demo `hooks` service |
| gateway `ports` | Put a TLS-terminating proxy (Caddy, nginx, a load balancer) in front of port 8080 |

We tested this: with `SEED_FIXTURES=false SEED_DEMO=false ADMIN_PASSWORD=…`, a clean install creates exactly one admin, no events and no sessions. The admin signs in with that password; a wrong password gets a 401. Running the seed again changes nothing.

**Back up three volumes:**
- `pgdata`: the database;
- `uploads`: images;
- `keys`: the Ed25519 signing key. If you lose it, existing certificates still verify (their public key is stored), but you can't issue records as the same key. If it leaks, someone else can sign as you.

**Upgrading:** pull, then `docker compose up -d --build`. Migrations run on start and only ever move forward, and the seed is idempotent.

---

## Development

```bash
npm run install:all            # installs apps/api and apps/web
npm run dev:db                 # Postgres on :5433 and Mailpit on :8025, in Docker
cd apps/api && npx prisma migrate deploy && npm run seed && cd ../..
npm run dev:api                # http://localhost:4000
npm run dev:web                # http://localhost:3000
```

**Tests** (in `apps/api`):
- `npm test`: 416 unit tests. No database needed; runs in seconds.
- `npm run test:integration`: 189 tests against the real API and a real Postgres. Each run creates its own throwaway database and drops it afterwards.
- `npm run audit:verify`: re-hashes the audit chain.
- `npm run openapi`: regenerates `docs/openapi.json`. A test fails if the spec and the mounted routes drift apart.

There are no automated browser tests. The web app was checked by hand in light and dark, and at phone width, against written test plans; the build journal records what those runs found.

---

## Known limits

We'd rather you read these here than find them.

- **Checker scope:** the official checker verifies T1 and T2 only. The T3 and T4 claims rest on the tests and steps above.
- **Fixture signal:** on the fixture data, judges barely agree with each other (the reliability estimate is about zero). No normalization can create signal the scores don't contain, and the portal says so on the Integrity page and in the proof report. The adjustment's benefit is shown in simulation, not on this dataset.
- **Webhook SSRF guard:** it checks the resolved address at send time. A hostile DNS server could still switch answers between the check and the connection (DNS rebinding). See the threat model.
- **Scaling:** the API-token rate limiter is in memory, per process. The webhook worker runs inside the API process. Running several API replicas is untested.
- **Certificates:** they print through the browser ("Save as PDF"). There is no server-side PDF.
- **Imports:** imported events bring reviews but not result runs; compute results again after importing.
- **Sign-in:** email and password or magic links only. There's no SSO or OAuth, and no two-factor sign-in.
- **Uploads:** stored on a local volume (no S3). Images only, 5 MB each.
- **Language and time zone:** English only. All times are shown and entered in UTC.
- **Tests:** there are no automated browser tests (see above), and the embed has no automated test.
- **More residual risks:** same-site CSRF (no Origin check or token), registration revealing whether an email has an account, and no audit-chain anchoring against a database superuser. See [THREAT-MODEL.md](THREAT-MODEL.md#residual-risks).

---

## Where things are

```
apps/api      Express 5 + Prisma 6 (Postgres 16), TypeScript strict. Everything that decides anything.
apps/web      Next.js 15 (React 19, Tailwind 4). Server-rendered pages that call the API.
gateway       nginx: one origin on :8080 for the web app and /api.
data          fixtures.json (the official fixture data).
docs          normalization proof, openapi.json
tools         verify-record.mjs (offline certificate check), offline-check.compose.yml
planning      plans, build journal, manual test plans
```

| Document | What's in it |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Services, request flow, background jobs, key design decisions |
| [DATA-MODEL.md](DATA-MODEL.md) | Tables, relationships, and the rules the database enforces itself |
| [JUDGING.md](JUDGING.md) | Normalization, integrity checks, results, head to head: method, evidence, limits |
| [THREAT-MODEL.md](THREAT-MODEL.md) | Assets, attackers, defences, and what's out of scope |
| [acceptance-report.txt](acceptance-report.txt) | Checker output |
| [planning/BUILD-JOURNAL.md](planning/BUILD-JOURNAL.md) | What we built when, and the bugs we found along the way |

## License

[MIT](LICENSE).
