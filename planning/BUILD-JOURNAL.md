# Build journal (raw material for the Write Up Quest)

Log anything surprising as it happens: a number, a bug, a design you abandoned, a trade-off. Use one line per entry, add IST timestamps, and include the real numbers. Don't polish anything here.

## Pre-kickoff (Thu 24 – Fri 25 Sep 2026)

- **Stack: MENN → keep Express/Next/Node, swap Mongo for Postgres.** Reason: the schema itself is judged, the invariants belong in the database (one team per person, one live project per team), and Mongo transactions need a replica set, which is a risk for `docker compose up`.
- **Read run.py before writing any code.** It runs 7 checks: 3 for T1 and 4 for T2, and nothing for T3 or T4. A tier only counts if every tier below it has checks that pass, so claiming T4 can never show as "verified". Asked on Discord: (pending)
- **SPA trap:** the checker reads the raw HTML of the gallery. A client-rendered gallery fails "project from fixtures shown" even though it looks fine in a browser.
- **The fixture is "40 projects", but it actually has 41.** prj_41 duplicates prj_07 (same team, same repo, submitted 3 minutes before close).
- **Three judges scored both duplicates and disagree with themselves.** jdg_19 gave 2.33 to one and 3.67 to the other. Merging the two entries would double-count judges. Decision: flag the later one and exclude it.
- **Z-score normalization made rankings worse than doing nothing** (simulation on the fixture's own assignment graph, 300 runs):

  | Method | Spearman ρ vs truth |
  |---|---|
  | raw | 0.854 |
  | z-score | 0.840 |
  | additive judge-effect + shrinkage | 0.887 |

  Why: judges have about 3–4 reviews each, and a standard deviation estimated from 3 numbers is noise. When judges have no bias, the model costs almost nothing (0.906 vs 0.912).
- **The judge graph is 1 connected component,** held together by only the 9 judges who span two tracks. Without them, offsets wouldn't be comparable across tracks.
- **Checker judge pair:** jdg_24 and jdg_26 share 5 projects and both cover trk_01. So the peer-scores test is blocked only by peer isolation, not by track isolation.

## Hackathon (Fri 25 Sep 23:30 IST → Mon 28 Sep 23:30 IST)

<!-- format: - **HH:MM Day** what happened (number / error / decision) → why it mattered -->

- **23:35 Fri** Chose a hybrid dev loop: Postgres and Mailpit in Docker, API and web run natively for hot reload. Test the full `docker compose up` after each feature.
- **23:40 Fri** npm 11 now **blocks install scripts by default**, so Prisma's engine download and esbuild silently didn't install. Had to approve them explicitly (`allowScripts` in package.json). Fine inside Docker, where node:22 ships npm 10.
- **23:48 Fri** The schema caught a fixture edge case my pre-kickoff analysis missed. `UNIQUE(eventId, team name)` failed on import: **3 team names are shared by different teams** (StillTrail ×3, AmberSwitch ×2, OpenSignal ×2). Different members, so they're genuinely different teams. The constraint was wrong, not the data. Replaced it with a plain index in migration #2. Lesson: let the database reject your assumptions early.
- **23:50 Fri** The importer's duplicate detection (same team + normalized repo URL) flagged prj_41 → prj_07 by itself. The gallery shows 40 projects, not 41.
- **23:55 Fri** The hash-chained audit log caught the checker's late-submission probe: `submission.refused_closed` by priya1@example.org. `UPDATE "AuditLog"` is blocked by a trigger.
- **00:10 Sat** In the container, `npx prisma` printed "New major version of npm available". **npx was phoning the registry**, which would stall with the network off. Switched to `./node_modules/.bin/prisma`.
- **00:12 Sat** Full `docker compose up` from an empty volume took **55 s** to a seeded portal. The acceptance checker passes all 7 checks, about 45 minutes after kickoff.
- **~23:45 Sat** T1 API finished: event setup, self-registration, teams with invite links, and the project draft → submit → unsubmit → withdraw lifecycle. Every rule goes through `policy.ts` (49 unit tests).
- **Sat** The lifecycle test found a bug in my test, not the code: jdg_24 is a judge of the *fixture* event, so joining a team in a *different* event is legitimate. The judge-can't-participate rule is per event, which is the right design. It still cost a confusing run where the team filled up early.
- **Sat** A real UX bug: opening an invite link again after joining said "team full" instead of "already a member", because the status check ran before the membership check. Reordered.
- **Sat** Invite links store only a sha256 of the token and show the raw link once. Joining locks the team row (`SELECT … FOR UPDATE`) so two people can't race for the last seat.
- **Sat** A draft/submit design decision: drafts can be incomplete, and "submitted" means complete (title, tagline, description, repo, track). A submitted project stays editable until the deadline, but you can't blank a required field. `submittedAt` keeps the *first* submission time.
- **Sun (early)** Closed the four gaps left in T1: image uploads (sha256-named files on a Docker volume; type read from the magic bytes, not the header; SVG refused because it can carry script), organizer-defined submission questions (5 types; required answers enforced at *submit*, not while drafting; private answers hidden from the public API, not just the UI), invite-by-email and password reset (both go to Mailpit offline; reset tokens are single-use and sign out other sessions), and editing prizes in place.
- **Sun** Full UI redesign, Devpost structure plus Unstop energy: event hub with banner, overlapping logo, sticky tabs, live countdown and a call to action that depends on your role; image-led project gallery; Devpost-style project pages; a participant dashboard with a progress stepper; an editor with a live submission checklist; an organizer console with a sidebar. Light and dark themes come from CSS tokens with a no-flash boot script. Fonts are bundled from npm, so it stays offline.
- **Sun** Generated covers: projects without images get a deterministic gradient and motif from a hash of their id, so the fixture's 40 image-less projects still look like a real gallery.
- **Sun** The built-in browser pane couldn't render screenshots while the app window was hidden, so I wrote a 60-line DevTools-protocol script driving headless Edge (cookie, viewport, prefers-color-scheme) to review every page in light, dark and at phone width. It caught 3 mobile bugs: a logo hidden under the banner (stacking context), track cards overflowing (grid item `min-width:auto`), and the CTA stuck at the bottom on phones.
- **Sun · T2 phase 1 (rubric + judges)** Rubric rule, and the reason for it: once any score exists, the *structure* (criteria, keys, score ranges) freezes, because changing a range would silently change what a "4" meant. Labels, guidance and **weights** stay editable, since weights are applied at compute time and never stored in scores. The fixture event shows the locked banner with 378 existing scores.
- **Sun** Judge invites create a password-less account plus a one-time "set up your account" link (the same mechanism as password reset, valid 7 days), emailed via Mailpit. Role conflicts are refused both ways: a participant can't be invited to judge, and a judge can't register to participate in the same event. Organizers can't also judge.
- **Sun** Integration tests: my first design ran `prisma migrate reset` on a `dogfood_test` DB, and **Prisma's own guard refused to run it from an AI agent** without explicit human consent. Rather than bypass it, I redesigned the setup: each run `CREATE DATABASE dogfood_test_<ts>`, applies `migrate deploy` (non-destructive), and drops only that DB in teardown. It's safer and gives better isolation between runs. The first run had 16/16 passing, including the DB trigger that rejects out-of-range scores regardless of app code.
- **Sun · T2 phase 2 (assignment engine)** A pure function, tested with **200 randomly generated events** for the hard rules (tracks, conflicts, no repeat pairs, recusals never re-assigned, cap), plus coverage, balance, determinism and incremental-fill tests.
- **Sun** The best finding of the day: my first version left the fixture split into **4 islands** of judges who never shared a project (trk_01, trk_02 and trk_08 each isolated). A "prefer bridging judges" tie-break wasn't enough. **trk_01 has 6 projects and exactly 3 eligible judges, so all three are forced to 6 reviews**, and the two who also cover another track are fully booked before they can bridge. Fix: a repair pass that swaps single new assignments to a judge in another island, keeping a swap only if the island count drops. It deliberately allows the receiving judge to be at the current max, so connectivity costs the busiest judge at most +1 review. Result on the fixture, same across 5 seeds: **1 connected graph, every project at 3 reviews, load 2–7** vs the fixture's own **1–11** (σ 1.5 vs 2.45). My test originally asserted a spread ≤3, which is impossible on this data; I fixed the test to assert what the data allows (max ≤ forced 6 + 1).
- **Sun** "What you previewed is what you get": commit recomputes the plan inside a transaction under a per-event advisory lock and compares a sha256 fingerprint of the inputs; if a judge, conflict or assignment changed since the preview, it returns 409 `stale_preview`. Commits are only allowed after the submission deadline (the project list must be final). Every batch records its algorithm version, parameters and seed, so it's reproducible.
- **Sun · T2 phase 3 (judge console)** Isolation by construction: every judge query filters on `judgeId = me`, and a peer's assignment returns **404, not 403** on every verb, so a judge can't even confirm it exists. Tested for GET, PUT, submit and recuse. Judges see only *public* answers to organizer questions.
- **Sun** Review lifecycle: autosaved partial drafts → submit (every criterion required) → revisable until judging closes, with every revision audited with before/after scores. Recusal deletes the draft; "declare a conflict" writes a COI row, so the Phase 2 engine will never route that team to the judge again. Judges can't recuse a submitted review.
- **Sun** Integrity data for Phase 6: `Assignment.openedAt` is set the first time a judge opens a project *while judging is open* (opening early doesn't start the clock), and `review.submit` audit rows carry `secondsSinceOpened`. First real value from the UI test: 97 s.
- **Sun** Tested the real UI end to end in headless Edge via the DevTools protocol: pressing "5" scored the first *unscored* criterion (I fixed focus to start there after seeing the screenshot), autosave persisted it, and clicking Submit moved the judge's progress to 3/3.
- **Sun · T2 phase 4 (progress + exports)** The live organizer view updates every 15 s, pauses while the tab is hidden, and catches up when you return. A "straggler" has a written, unit-tested definition: more than 20 points under a steady pace to the deadline, or nothing opened once a fifth of judging has passed, or incomplete after close. The tolerance is generous on purpose; judges work in bursts.
- **Sun** Two fixes for stragglers. **Remind** emails the judge their outstanding count and the deadline, with a 6-hour cooldown enforced server-side (from the audit log, not the UI). **Redistribute** reuses the Phase 2 engine through a new `onlyProjects` option: it fills only the released projects, and every other project still counts toward load and connectivity. It releases only *untouched* work, uses the same preview → fingerprint → commit flow, and returns 409 if the judge starts a review in between.
- **Sun** A bug caught by a test: the timeline was sampled at 40 even points, so the latest reviews (made "now") didn't appear until the next sample. Added an exact "now" point.
- **Sun** CSV at every stage: participants, teams, projects (with custom answers, private ones marked), judges, assignments, reviews (long format, one row per criterion), results, and the hash-chained audit log. Downloads are themselves audited, since the files hold personal data. There is a UTF-8 BOM for Excel, and formula injection is neutralized (tested with `=HYPERLINK(...)`).
- **Sun** Seeded a third event, "Spring Build Sprint", frozen halfway through judging, so a fresh `docker compose up` shows the engine at work: a generous judge (+1.6), a harsh one (−1.7), a flat 7-for-everything judge who takes about 1 min per review, one recusal with a declared conflict, a draft in flight, one judge behind, one who never started, and one comment that contradicts its score. Phases 5 and 6 (normalization and integrity checks) will run on this data. Assignments come from the real engine, not hand-written rows.
- **Sun** Mobile bug: the manage layout's single column below `lg` was an implicit `auto` track, so the 760 px judges table widened the whole page. Fixed with `grid-cols-1` (`minmax(0,1fr)`); the table now scrolls inside its card.
- **Sun · T2 phase 5 (normalization)** Engine: an additive judge-effect model with ridge shrinkage, solved by coordinate descent. It's about 60 lines of TypeScript with no maths library and is fully deterministic. Tested for convergence, input-order invariance, and translation and scale equivariance. Unit tests on synthetic events: it beats raw averages across 100 biased events and costs <0.02 ρ across 100 fair ones; it undoes a harsh/generous pair that raw averages rank the wrong way round; a single-review judge's offset is exactly deviation/(1+λ); a flat judge causes no NaN.
- **Sun** A plan change backed by evidence: I re-ran the λ sweep on the fixture's real graph (300 runs per cell, scores rounded like real rubric scores). λ_j = 2 is within 0.001 ρ of the best when judges are biased, and costs half as much as λ_j = 1 (−0.006 vs −0.014 against raw) when they aren't. It's also near the theoretical σ²_noise/σ²_bias ≈ 1.6. The default moved from 1 to 2.
- **Sun** An honest finding from a failing test: with λ_p > 0, a little project quality leaks into judge offsets even when judges are perfectly fair (a judge who drew a strong batch looks slightly generous). The test now states that property, and a second test shows that with λ_p = 0 the model reproduces raw averages exactly.
- **Sun** Fixture results match the prototype's story: prj_34 overtakes prj_11 for #1; prj_10 (2 reviews, one from generous jdg_15) falls from #3 to #6; jdg_02 (+0.44) and jdg_15 (+0.38) come out generous, jdg_10 (−0.34) harsh, and jdg_07 is flagged "same score for everything". One connected graph, ρ(raw, adjusted) = 0.964.
- **Sun** Rank uncertainty instead of vague "ties": a seeded simulation draws each score from N(score, se²) and reports each project's 5th–95th percentile rank and its chance of a top-k finish (k = number of overall prizes). With the fixture's noise (σ ≈ 0.70 on 1–5, 3 reviews each), even #1 has a likely range of #1–18 and a 51–55% chance of the top 4. Organizers should see that before handing out money.
- **Sun** Runs are immutable snapshots, enforced by DB triggers, not just the API. A publish needs judging closed and the run's input fingerprint (every score, weight, range, duplicate flag and option) must still match the data; otherwise it returns 409 `stale_run`. Excluding a judge needs a written reason, which is stored in the run and the audit log. The public endpoint returns rank, adjusted score and review count only: no judge ids, offsets, raw scores or errors (tested). The seed publishes one run for the finished fixture event through the same code path, audited as `system:seed`.
- **Sun · T2 phase 6 (integrity + proof)** Eight deterministic checks, no AI: outlier score, comment that contradicts its score, same score on every criterion, scores that barely vary, a judge opposite to the panel, rushed reviews, consistently fast judges, pasted comments. Flags never change a score. The organizer marks each one "looks fine" (a reason is required) or "confirmed", can reopen it, and every decision is audited. Flag keys are stable, so a decision survives recomputation. "Exclude judge…" deep-links into the Results exclusion dialog.
- **Sun** Tuning against real data, not guesses:
  - The fixture has only 4 distinct comments, so copy-paste detection ignores anything under 25 characters. Otherwise it flags "Docs are thin." 29 times.
  - Raw residuals understate surprise where judges have few reviews, so the outlier check divides by σ√(1−h) with a two-way leverage. That surfaces jdg_04 on prj_37 (z = −2.6, as the prototype predicted).
  - A leverage of 1 for single-review judges produced a fake z = −4.3, so outliers now require ≥2 reviews on both sides.
  - "Opposite to panel" first fired at r = −0.06, which is just noise; the threshold is now r ≤ −0.3. That leaves jdg_04 (r = −0.99).
- **Sun** **The biggest finding of the build:** the fixture judges agree with each other no better than chance. One-way ICC is 0: between-project variance is at or below within-project variance, on every criterion. The fixture scores look randomly generated. Normalization removes leniency, but it can't create signal that isn't in the data. That explains why even #1's likely rank spans #1–18. The integrity page now warns when ICC(1,k) < 0.5 and tells organizers to treat close ranks as ties.
- **Sun** `npm run judging:proof` reads fixtures.json directly (no DB, no Docker) and writes docs/normalization-proof.md in about 17 s, seeded. It uses the same code as the app: the duplicate rule was extracted from the importer into a pure `detectDuplicates` so both apply it identically. Headline, over 300 simulated events on the fixture's real graph: additive ρ 0.805 vs raw 0.773 vs z-score 0.747 (z-score is worse than doing nothing); winner found 40% vs 37% vs 29%; the fair-judge control costs 0.008; λ_j is flat from 0.5 to 4. Organizers can download the same report for their own event, simulated on their event's graph, from Results or Integrity.
- **Sun** Demo seed: comments are now varied per review (templated ones tripped copy-paste detection), plus two planted cases: Ava's "Didn't run for me" with 9/9/8/9, and one of Gus's reviews at 1/1/1/1. Farah reviews in 30–110 s. The integrity page finds exactly these and nothing else.
- **Sun · T3 phase 1 (voting core)** The organizer chooses one of three ways voters prove who they are, named by strength:
  - **Verified email** (the default): a one-time sign-in link, no password, and the account is created on the spot.
  - **Ballot codes**: single-use codes, stored hashed like passwords.
  - **Any account**: the weakest option, labelled as such.

  Organizers and judges are kept out of the community vote, and nobody can vote for their own team. Everyone gets a fixed budget of 3 votes, changeable until close.
- **Sun** "One inbox, one ballot" normalizes addresses: Gmail dots are ignored and `+tags` are stripped everywhere, and a unique database index holds that key per event. Tested with `sam.voter+one@gmail.com` vs `samvoter@googlemail.com`.
- **Sun** Random ballot order: each voter gets a Fisher–Yates shuffle seeded by sha256(event + identity), so it's stable across reloads and independent between voters. The position each pick was shown at is stored, which lets Phase 4 prove that list position didn't matter. A chi-square test over 6,000 simulated voters confirms every project comes first equally often.
- **Sun** "Results hidden" is structural: while voting is open, no endpoint anywhere returns a count, and organizers get turnout only. A test checks every relevant response for tally fields and project ids. The audit log records that a ballot was cast or changed and how many picks it has, never which projects.
- **Sun** Defence in depth in the database: a trigger rejects ballot choices from another event, choices for duplicate or unsubmitted projects, and choices over the cap. A ballot save also locks the ballot row, so two tabs can't race past the limit.
- **Sun** Security details worth calling out:
  - The sign-in link lands on a page with a "Continue" button, so email scanners that prefetch every link can't burn the single-use token.
  - `next` accepts only same-site paths, so there's no open redirect.
  - Link requests are limited to 5 per inbox per hour (silently) and 20 per IP per hour.
  - Wrong ballot codes are audited and rate-limited per IP.
- **Sun** On phones, the ballot summary (votes left, receipt) was below 15 project cards. It now comes first.
- **Sun · T3 phase 2 (anti-abuse)** Six detection signals, each deliberately weak on its own: same /24 network, identical ballots in a burst, accounts made minutes before voting, numbered addresses, a sudden surge, and votes for projects the voter never opened (recorded with a new `ProjectView` table). Signals that point at mostly the same ballots merge into one **incident**, whose severity is the number of *independent* kinds of evidence (3+ high, 2 medium, 1 low). A campus class voting together scores low; a stuffing ring scores high. Nothing is removed automatically: organizers quarantine (with a reason; the ballots are kept and simply not counted) or mark an incident as fine, and every decision is audited.
- **Sun** Tuning lessons:
  - The first "voted without looking" rule needed 60% of a project's votes to be blind. A ring voting for a project that also has real fans fell just short (12 of 22). The rule now compares against the event's own blind-vote rate on other projects: at least 40%, and at least twice the baseline.
  - The seeded fans were called `fan01..34@`, and the numbered-address check flagged them all. That was the check working, so the seed now uses realistic addresses.
- **Sun** Prevention:
  - A bundled list of throwaway email providers (works offline) blocks both the voting link and the ballot.
  - Rate limits allow 60 new ballots per network per hour (generous, because a venue's whole audience can share one IP) and 30 changes per ballot per hour.
  - The review screen masks emails (`d***7@outlook.com`). It names the project a flagged group backed, a deliberate limited disclosure: you can't judge a brigade without knowing who it helps.
- **Sun** Demo seed: 34 ordinary fans, a class of 6 from one campus (low severity), and a ring of 12 `dev.hunter01..12@outlook.com` accounts backing Portly (high severity, all six signals). The review queue finds exactly those two incidents and flags none of the fans.
- **Sun · T3 phase 3 (comments)** Project comments are plain text, stored exactly as typed and rendered as text nodes and `<a>` elements, so there's no HTML to sanitize (a test posts `<script>` and `<img onerror>` payloads). Links get `rel="nofollow ugc noopener"`.
  - **Replies:** one level deep, enforced by a DB trigger.
  - **Badges:** Team and Organizer.
  - **Authors:** can edit for 15 minutes, with the previous text kept in the audit log so an edit can't quietly rewrite a conversation, and can delete any time. The row is kept for moderation and a placeholder shows only if replies hang off it.
- **Sun** Judges can't comment until judging closes: a judge's public remark could sway other judges and reads like a verdict. The judge console never shows comments or votes.
- **Sun** Spam guards:
  - brand-new accounts (under a day old) can't post links
  - the same comment twice (ignoring case and punctuation) is refused
  - at most 5 comments per 10 minutes and 30 per day

  Three reports from established accounts hide a comment automatically, pending review. Reports from throwaway accounts don't count, so a handful of fresh accounts can't silence someone. Organizers hide with a reason, restore, or dismiss wrong reports, which also undoes an automatic hide. The event can set comments to open, read-only or off. `comments.csv` joins the exports.
- **Sun** Seeded discussion: questions answered by the teams, a link from an established fan, and the ring's "VOTE PORTLY!!!" spam with two reports in the moderation queue. The demo story links up: the same accounts show up in Vote review *and* in comment moderation.
- **Sun · T3 phase 4 (People's Choice)** Approval counting: one pick is one vote, and quarantined ballots aren't counted. Ties share a rank ("1, 2, 2, 4"): a coin flip would pretend to a precision the vote doesn't have. Organizers can preview the count only after voting closes (the `ballots.csv` export is sealed until then too), and they publish once they're satisfied.
- **Sun** "Anyone can recount": publishing fixes the SHA-256 of an anonymous ballot file. It lists every ballot under `sha256("dogfood-receipt:" + receipt)`, with picks, the position each was shown at, and counted or quarantined status. The file is sorted by hash, so neither timing nor identity can be read off it. The public page shows the fingerprint and whether today's file still matches. Voters check their receipt (sent in the request body, never in the URL) and see "counted, your picks: …", or honestly "set aside after review". While results are public, quarantine decisions are locked; unpublishing to revise is itself audited. A test recounts from the downloaded file alone and matches the official ranking.
- **Sun** Proof that the shuffle worked: a chi-square test of picks by the position they were shown at against an order-blind crowd (α = 0.01), with an honest "too little data" state. The tests confirm it finds nothing with random order and merit-based voters, and catches a crowd that picks whatever is listed first. On the seeded sample event: χ² ≈ 4–8 against a 13.28 critical value, so no position effect.
- **Sun** Two flaky tests traced to tie order and receipt pick order following random UUIDs. Ordering by title is also the better display order, so the fix improved the page too. Seeded a finished, published vote on the fixture event (about 82 voters plus a quarantined ring of 4), including a ballot for the demo voter, so the receipt check can be shown end to end.
- **Sun · T4 phase 1 (API First)** The web app already talked to the backend only through the REST API, so "a documented REST API" meant documenting what exists and opening it to scripts, not building a second API.
  - **Personal API tokens.** `dfp_` + 32 random bytes. Only the sha256 is stored, and the token is shown once. The prefix lets secret scanners recognise a leaked token. Scopes are `read` (GET only) and `write` (always paired with read). Lifetimes are 7, 30, 90 or 365 days, or no expiry. At most 25 active tokens per user, counted under a row lock. Revoking works on the very next request.
  - **Failing loudly.** A bad token gets a 401 with `WWW-Authenticate`, instead of being treated as anonymous. A script with a revoked token should fail, not quietly get public data.
  - **Limits and records.** Each token is rate-limited to 600 requests a minute with `RateLimit-*` headers. It records when it was last used and from which IP (written at most once a minute). Audit entries read `organizer@… (API token "Nightly sync")`.
- **Sun** Deliberate limits on tokens: they can't manage tokens (a leaked token can't mint a longer-lived one), vote, or comment. Those return 403 `session_required`, so a token can't be turned into a ballot or comment bot. Tokens can't get around role checks: a judge's token still can't read a peer's scores (tested).
- **Sun** **OpenAPI 3.1 from the handlers' own validators.** About 40 inline zod schemas were moved into named exports, and `src/openapi/operations.ts` lists all 116 routes with who can call each one. The request schemas are the exact objects the handlers parse with, so the documented contract is the enforced one.
  - `app.ts` now mounts routers from a table.
  - Drift guards:
    - A unit test walks every router's stack and fails on any route that is served but not documented, or documented but not served.
    - Another test fails if the committed `docs/openapi.json` is out of date.
    - Response schemas for the main read endpoints are checked against live responses in the integration tests (event list and detail, gallery, project, published results, People's Choice, `/me`, tokens, uploads, errors).
  - One bug found while writing the catalogue: the docs first described `POST /api/events` with the update schema, not the create schema. Fixed by exporting the real one.
- **Sun** Docs page `/developers`: rendered on the server from `/api/openapi.json`, with no CDN (Swagger UI would break offline). It has a quick start, a filter, method and access badges, a "browser only" marker, field tables with constraints, and a curl line per operation. Links to `#operationId` open that operation. `/account/tokens` has scope cards, expiry choice, the one-time reveal with copy and a curl line, and a list with last-used info and revoke. The seed adds a read-only organizer token, `dfp_demo-organizer-read-only`, so the docs' curl examples work on a fresh install (removed with SEED_DEMO=false).
- **Mon · T4 phase 2 (webhooks)** The audit log doubles as the event stream. `appendAudit()` already runs inside every change's transaction, so it also writes the outbox rows for subscribed endpoints. A webhook is queued if and only if its change commits: no announcements of rolled-back changes, and no committed change that skipped its webhook. There's a test for each direction. The payload id is `evt_<audit id>`, which ties every delivery back to its audit entry.
- **Mon** 20 curated event types (`project.submitted`, `results.published`, `review.submitted`, …), each mapped from audit actions and described by a zod schema. The schemas appear in the OpenAPI 3.1 `webhooks` section, and a test checks a real delivery against its schema.
  - **Thin payloads.** Ids, a few public fields and API links; never scores, emails or comment text.
  - **No ballot events, on purpose.** A `ballot.cast` feed would let anyone with a receiver watch the count while voting is open, and the portal keeps counts sealed until voting closes. A test checks that an all-events subscriber gets nothing when a ballot is cast.
- **Mon** Signatures follow **Standard Webhooks**: `webhook-id`, `webhook-timestamp` and `webhook-signature: v1,<HMAC-SHA256>`, with `whsec_` secrets. The unit test uses the spec's published test vector, so any off-the-shelf Standard Webhooks library can verify our deliveries. Rotating the secret keeps the old one signing alongside the new one for 24 hours, so receivers switch over without dropping anything.
- **Mon** The worker runs inside the API process.
  - **Claims.** Deliveries are claimed with `FOR UPDATE SKIP LOCKED` and a two-minute lease, so several API instances can run side by side and a crashed attempt is simply retried. Delivery is at-least-once, so receivers de-duplicate on the id.
  - **Retries.** Up to 8 attempts, backing off from 1 minute to 24 hours (about 45 hours in all), with ±10% jitter.
  - **Switching off.** An endpoint switches itself off after it has been failing for 24 hours or answers 410 Gone. Short outages never switch anything off, and switching back on doesn't unleash a backlog.
  - **Redirects** are not followed.
- **Mon** Two real bugs from the concurrency test ("two workers, twelve deliveries, each sent exactly once"):
  - Sending a whole batch at once exhausted the database connection pool. Sending is now four at a time.
  - Concurrent attempts read the endpoint's failure streak before any of them wrote it, so failures went uncounted. The endpoint row is now locked and read inside the recording transaction.
- **Mon** SSRF guard: an organizer chooses where the server sends requests, so URLs pointing at private, loopback, link-local (cloud metadata) or `.internal` hosts are refused when saved. They're checked again after DNS resolution at send time. Only hosts named in `WEBHOOK_ALLOW_PRIVATE_HOSTS` are exempt. There's a residual DNS-rebinding window between the check and the connection; it's documented for the threat model.
- **Mon** UI:
  - The manage pages list endpoints with 24-hour delivered, retrying and gave-up counts.
  - Adding an endpoint reveals the secret once and sends a test.
  - Each endpoint has a live delivery log with every attempt (status, time, response excerpt), the exact payload, and redeliver (same message id).
  - The API reference renders every event's payload fields and a 10-line Node verification snippet.
- **Mon** Demo: a `hooks` compose service (the API image running `webhook-receiver.js`) verifies signatures and lists what arrived at http://localhost:9000. The seed adds a healthy endpoint and one that's down on purpose, so the log shows success, 503s and scheduled retries straight after `docker compose up`.
- **Mon · T4 phase 3 (signed records and certificates)** The Ed25519 private key is a PEM file on its own volume (`SIGNING_KEY_PATH`, mode 0600, created on first start), never in the database, so a stolen database dump can't forge a certificate. The public half is registered in `SigningKey` under a kid (sha256 of the SPKI, first 16 hex characters). Replacing the file rotates the key: the next start registers the new key and marks the old one retired, and records it signed stay verifiable. There's a test for this.
- **Mon** What gets signed: a versioned statement (issuer, kid, event, subject name, claims, verify URL) as canonical JSON.
  - **Judges** who submitted a review get a participation record: review count, projects, tracks, and a `reviewsDigest`, a SHA-256 over their exact reviews and scores. It commits to the work without revealing a score. If a judge's work is ever disputed, the organizer can show the reviews and anyone can check them against the digest.
  - **Team members** of submitted projects get a certificate with the project and, once results are public, their placement and People's Choice rank.
  - **Never included:** emails and scores.
- **Mon** Records never change.
  - A trigger blocks any edit to what was signed, blocks un-revoking, and blocks direct deletes (cascades from deleting an account are allowed). A test tries each one with raw SQL.
  - Re-issuing re-signs only people whose facts changed (for example after results are published) and supersedes the old record. The "one current record per person" index is partial, so the supersede foreign key is deferred to commit.
  - Revocation is permanent, needs a reason, and is audited. A revoked person isn't quietly re-issued.
  - Issuing is locked per event and only allowed once judging has closed.
- **Mon** Three independent ways to verify:
  - `/verify/:id` re-checks the signature in the visitor's browser with WebCrypto Ed25519 over the exact `signedText` the API returns, and shows the claims parsed from that same text. What you see is what was verified.
  - `tools/verify-record.mjs` is plain Node with no packages; `--key` pins the issuer's key.
  - `--openssl` writes the files for `openssl pkeyutl -verify -rawin`. Checked by hand: "Signature Verified Successfully".
  - An integration test runs the tool on a downloaded record, then forges a placement in it; the tool exits with 1.
- **Mon** Certificates: an A4-landscape page with container-query sizing, so it scales from phone to paper. Fixed colours make it print the same in dark mode. A QR code (the `qrcode` package, rendered to SVG on the server) links to the verify page. A revoked or superseded certificate prints a watermark. "Print or save as PDF" uses the browser, so there's no PDF library.
  - Pages: *My certificates* for each person, and *Manage → Certificates* (issue, re-issue changed, revoke with a reason).
  - A `records.issued` webhook fires on issuing.
  - The seed signs 121 records for the sample event (30 judges, 91 participants).
- **Mon · T4 phase 4 (bulk import/export and embed)** `dogfood-event/v1` is one JSON file per event, holding:
  - settings, tracks, prizes, rubric and questions;
  - people, organizers, judges (with their imported ids) and teams;
  - projects with answers and duplicate links;
  - conflicts, assignments, and reviews with scores.

  People are referenced by email, everything else by its imported id if it has one, otherwise its uuid. Exports are sorted, so the same event always gives the same file.
  - **Deliberately left out:** passwords (accounts are claimed again), ballots (bound to identity checks that don't transfer), comments (third-party speech), and anything bound to this install (results runs, audit chain, signed records, webhooks, tokens). Results are recomputed from the reviews.
  - **Import** (`POST /api/events/import`, admin only) takes v1 or the DOGFOOD fixture format through an adapter. It checks every reference first and reports all problems at once. Then it writes the event in one transaction. Existing accounts are reused by email and never modified; new accounts have no password.
  - **Dry run** is the real import, rolled back, so the preview can't disagree with the actual import. A test shows the event, user and audit counts are unchanged afterwards.
- **Mon** Tests prove the round trip: export → import → export gives the same file, *and* the same judged ranking. The fixture adapter and the seed importer are cross-checked too: both build identical events from fixtures.json, which turns their duplicated logic into a test.
- **Mon** Two real bugs found by the round-trip test:
  - "One live project per team" is a partial unique index. Linking duplicates *after* inserting briefly gave a team two live projects. The link is now set in the same insert, whose foreign key is checked at the end of the statement.
  - **Exact ties were split by uuid.** prj_09 and prj_17 have identical normalized scores and review counts, and `rankBy` broke the tie by project id. That's arbitrary, and it changes when ids change (an import). Ties now share a rank ("1, 2, 2, 4"), as People's Choice already did; there are unit tests for this. `docs/normalization-proof.md` was regenerated; only rank numbers and the movement arrows changed.
- **Mon** Embed:
  - `/embed/:slug` is a chrome-free gallery with search, track chips and top-three medals once results are out. Links open on the portal in a new tab.
  - It's always rendered as an **anonymous** visitor (the server API client got an `anonymous` option). A signed-in organizer looking at a sponsor's page never pulls private data into it, and there's nothing in it to clickjack.
  - That's what justifies the framing policy: `/embed/*` sends `frame-ancestors *`; every other page sends `X-Frame-Options: DENY` and `frame-ancestors 'none'`. Checked with curl.
  - `public/embed.js` is one script tag with data-attributes. It inserts the iframe and auto-sizes it from `postMessage` height updates, accepted only when they come from its own iframe and the portal's origin.
  - Tested from a real third-party origin (a host page on :5500): the gallery rendered and sized itself so the host's footer sits right below it.
  - *Manage → Embed* has options, script or iframe code, and a live preview. *Manage → Exports* gained "Full event (.json)"; admins get *Import an event* with a preview-then-import wizard. The gateway body limit was raised to 26 MB for imports.
- **Mon · Product polish (A–G)** After T4, the product frame around the features.
  - **Shell.** A top nav (Dashboard, Hackathons, Projects, Host a hackathon, Developers) with a portalled mobile menu. The header's backdrop-filter was trapping the fixed panel; the screenshots caught it.
  - **Dashboard.** A role-aware home: deadlines, then your events grouped by role (organizing, judging, building).
  - **New pages.** `/hackathons`, cross-event `/projects` search, and a footer, 404 and error pages.
  - **Dialogs.** In-app confirm/prompt dialogs and toasts replaced all ten native `confirm`/`prompt` calls.
- **Mon** **Open hosting.** Any signed-in user can host (`HOSTING=admins` restricts it; importing stays admin-only).
  - New events are **drafts**, and one guard in front of every `/api/events/:slug/*` router 404s a draft for everyone but its organizers and admins, so no route can forget it.
  - Publish anytime; unpublish only while nobody has joined.
  - **Duplicate** copies setup, tracks, prizes, rubric, questions and organizers into a new draft with the whole schedule shifted.
- **Mon** **Profiles.**
  - Handles, backfilled from names in the migration and created lazily for new users. Reserved words refused; a CHECK on the format.
  - `/u/:handle` shows a bio, links, skills, stats, hackathon history with placements, and certificates, from public events only and never the email.
  - Settings cover profile, password (changing it signs out other sessions) and sessions. Team members and comment authors link to profiles.
- **Mon** **Notifications.** Derived from the audit log in the same transaction, like webhooks.
  - Types: team joins and leaves, submissions, judge invites, new assignments, results, People's Choice, certificates, comments and replies, hidden comments, a switched-off webhook, and organizer announcements.
  - People never get notified about their own actions; muted categories are skipped.
  - Deadline reminders (24 h and 1 h before submissions close, to teams without a submitted project; 24 h before judging closes, to judges with work left) run from the worker. A unique key makes each one fire once however often the job runs.
  - Emails use an outbox (`emailWanted`/`emailedAt`) and respect the person's email setting.
  - UI: a bell with an unread count, a `/notifications` page, and per-category preferences.
- **Mon** **Webhooks.**
  - **Slack and Discord formats:** paste an incoming-webhook URL and get one readable line per event. Discord mentions are disabled, so a project title can't ping @everyone.
  - Create at the top of the page, with sensible chat defaults, and Test, Pause/Resume, Log and Delete on every endpoint.
- **Mon** **Community.**
  - Organizer **announcements** (Updates tab; pin, edit, delete; notify participants and judges).
  - A **team finder**: people looking and teams with room. Posts drop off automatically once someone joins a team or a team fills. "Invite to team" sends a single-use join link as a notification. Posting counts as registering.
- **Mon** **Copy pass.** About 45 over-explaining helper texts cut to short product lines (including an integrity note that literally said "not AI"). The sparkle badge and eyebrow labels are gone.
- **Mon** Demo seed: filled-in profiles for the demo accounts, notifications in their bells, announcements on the live events, and a team finder with four people looking and one team with room.

## Polish: finishing D and F (Sep 28)

- **Organizer alerts.** `notifications/watch.ts` runs once a minute in the worker. `watchJudges` uses the same straggler rule as the progress dashboard (`assessJudge`): a judge who is behind pace, or hasn't started after 20% of the window, raises one alert per organizer. `watchVoting` alerts on high-severity vote incidents that have no organizer decision. Unique keys (`behind:…`, `incident:…`) mean each alert goes out once. Pressing "Remind" on the progress page now also puts a notice in the judge's bell (`judge.reminded`). It has `noEmail`, because that route already sends the email.
- **Seed.** Dropped the canned "suspicious voting" demo alert, since the real watcher now produces it from the planted ring.
- **Loading states.** `components/Skeleton.tsx` plus `loading.tsx` files for the root, the event hub, the organizer console and account pages.
- **Sweep (light, dark, 390px).**
  - Dashboard: new "Open to join" section, so a participant whose events have all ended still sees what's live.
  - Event hub on phones: the status card now sits under the content except on Overview, and the active tab scrolls into view.
  - Trimmed the progress page subtitle.
- **Checks.** Tests: 400 unit, 178 integration. Checker: T1 T2 verified.

## Step-by-step create flow (Sep 28)

- `/events/new` is now a five-step wizard (`app/events/new/CreateWizard.tsx`): Basics → Schedule → Tracks & prizes → Judging → Review.
  - **Schedule:** Weekend, Week-long and Month-long presets fill all five dates from one start time. Registration opens two weeks ahead, clamped to now. The client runs the same ordering checks as the server's `scheduleProblems`, so problems show before the last step.
  - **Rubric:** Standard (four weighted criteria, 1–5), Single score (1–10), or Set up later.
  - **Create:** nothing is written until the last step. That step creates the draft event, then its tracks, prizes and criteria through the existing endpoints. Any partial failure is reported in a toast, and the wizard then opens the organizer console.
  - **Autosave:** the half-filled wizard is kept in localStorage.
- `EventForm` is now schedule-only (organizer console).
- **Verified:** one event created in the browser end to end, with its track, prize and 4-criterion rubric present, checked through the API.
