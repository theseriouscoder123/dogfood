# Test plan 2: community (T3) and platform features (T4)

This plan covers everything built since `TEST-PLAN.md`:

- **T3**: community voting, anti-abuse review, comments and moderation, People's Choice.
- **T4**: API tokens and OpenAPI docs, webhooks, signed records and certificates, the embeddable gallery, and bulk import and export.

Run `TEST-PLAN.md` §3 (smoke) as well: T1 and T2 must still pass. It has three layers:

1. **Automated suites** (§2). About 5 minutes.
2. **Smoke test for the new features** (§3). 20 minutes; do it after every rebuild.
3. **Full manual regression** (§4–§7). About 3 hours for one person, or about 45 minutes each for four people (§9).

Every case has an ID, steps, and an **expected** result. Tick the box when it passes. Report failures with the template in `TEST-PLAN.md` §11.

---

## 1. Setup

### 1.1 Fresh stack
```bash
docker compose down -v
```
```bash
docker compose up -d --build
```
Wait for `api` to be healthy (`docker compose ps`). The API log ends with `signing records with Ed25519 key <kid>` and the seeded logins.

| What | URL |
|---|---|
| Portal | http://localhost:8080 |
| Mailpit (sign-in links, invites, reminders) | http://localhost:8025 |
| **Demo webhook receiver** (new) | http://localhost:9000 |
| API reference (new) | http://localhost:8080/developers |

> **Time matters.** The Spring Build Sprint's voting and judging windows run from 2 days before first boot to 2 days after. After that its "live" cases (voting, commenting, stragglers) stop working. Reset with §1.1.

### 1.2 New seeded logins (password for all: `dogfood2026`)

| Who | Email | API header | Use it for |
|---|---|---|---|
| Voter (verified, hasn't voted in Spring Build Sprint) | voter@dogfood.local | `Cookie: sid=seed-voter` | ballots, receipts |
| Organizer's read-only API token | organizer@dogfood.local | `Authorization: Bearer dfp_demo-organizer-read-only` | token checks |
| Organizer / Admin / Judges / Participant | as in `TEST-PLAN.md` §1.2 | `sid=seed-organizer`, `sid=seed-admin`, … | |

### 1.3 Event states for these tests

| Event | Voting | Comments | Other |
|---|---|---|---|
| Sample Hack 2026 | **Closed and published**: about 82 voters, 4 quarantined ballots, one ballot by voter@dogfood.local | open | Results published; **121 signed records** issued |
| Spring Build Sprint | **Open**, verified-email mode, 3 votes each. A 12-account ring backs *Portly*; a 6-person campus group votes together. | open, with a reported spam comment on *Portly* | Judging open; **2 demo webhooks** (one healthy, one down on purpose) |
| Dogfood Demo Jam | off | open | Submissions open |

Use a normal window plus private windows to be several people at once. For the API cases, use a terminal (`curl`) or DevTools → Network.

---

## 2. Automated suites

From `apps/api` (the database container must be running):

| ID | Command | Expected |
|---|---|---|
| A-1 | `npm run typecheck`, and `npx tsc --noEmit -p .` in `apps/web` | no output |
| A-2 | `npm test` | **400 passed**, 14 files. Includes the OpenAPI drift test (every mounted route documented, committed `docs/openapi.json` current), the Standard Webhooks test vector, and Ed25519 signing. |
| A-3 | `npm run test:integration` | **156 passed**, 14 files: voting, vote-abuse, comments, voting-results, api-tokens, webhooks, records, portability, plus the T1/T2 files |
| A-4 | `npm run openapi`, then `git status` | `docs/openapi.json` is unchanged |
| A-5 | `npm run audit:verify` | `audit chain intact (N rows)` |
| A-6 | Official checker (`python planning/spec/run.py <toml> --fixtures data/fixtures.json`) | `claimed T1 T2, verified T1 T2`, 7 × PASS. T3/T4 have no automated checks; that's expected. |

---

## 3. Smoke test for the new features (20 min)

- [ ] **S2-1** As voter@dogfood.local: Spring Build Sprint → **Vote** tab. Projects are listed; pick 3, then **Save** → a receipt `DF-XXXXX-XXXXX` appears.
- [ ] **S2-2** Sample Hack → **People's Choice** tab (logged out): podium, full list, a "Did list position matter?" chart, and a `ballots.json` download with its SHA-256.
- [ ] **S2-3** A project page in Spring Build Sprint: comments show with replies; post one (as the voter) → it appears.
- [ ] **S2-4** As organizer: Spring Build Sprint → Manage → **Vote review** shows a **high** severity incident (the Portly ring) and a **low** one (campus).
- [ ] **S2-5** http://localhost:8080/developers loads, with "OpenAPI 3.1.0" and **135 operations**. The filter works (type `webhook`).
- [ ] **S2-6** User menu → **API tokens** → create a read-only token → copy it → its curl line returns your user.
- [ ] **S2-7** Manage → **Webhooks** (Spring Build Sprint): two endpoints. http://localhost:9000 lists a `webhook.ping` marked **✓ valid**.
- [ ] **S2-8** Sample Hack → Manage → **Certificates** shows 121 current records. Open one → **View certificate** → a certificate with a QR code.
- [ ] **S2-9** Any `/verify/<id>` shows "Authentic and current" and **"verified in your browser"**.
- [ ] **S2-10** Manage → **Embed**: the live preview shows the gallery with 1st/2nd/3rd medals.
- [ ] **S2-11** Manage → Exports → **Full event (.json)** downloads a file of about 90 KB.
- [ ] **S2-12** New pages in dark mode and at 390 px width: no clipped text and no page-wide horizontal scroll.

---

## 4. T3: community

### 4.1 Voting as a voter (Spring Build Sprint)
- [ ] **V-1** Logged out, open the Vote tab. **Expected:** it asks for your email, and there are no counts anywhere on the page.
- [ ] **V-2** Enter a new address (e.g. `tester1@example.org`) → "Check your inbox". In Mailpit, open "Your voting link…" → the link lands on a page with a **Continue** button (so link scanners can't burn it). Press it → you're signed in on your ballot.
- [ ] **V-3** Open the same link again. **Expected:** refused (single use).
- [ ] **V-4** Try `someone@mailinator.com`. **Expected:** "Throwaway email addresses can't vote."
- [ ] **V-5** **Random order:** note the order of the first five projects. In another private window, sign in as a different new voter. **Expected:** a different order. Reload the first window: its order is unchanged (stable per voter).
- [ ] **V-6** Pick 4 when the limit is 3. **Expected:** "You've used all 3 votes. Remove one to pick another." The vote dots show 3 used.
- [ ] **V-7** Save → receipt. Change a pick and save → **the same receipt**, updated time.
- [ ] **V-8** **One inbox, one ballot:** vote as `jane.doe@gmail.com`, then sign in as `janedoe+2@gmail.com` (the same Gmail inbox: dots and +tags are normalized). **Expected:** the second one can't cast another ballot (it's the same inbox).
- [ ] **V-9** Log in as a **team member** of a Spring Build Sprint project. **Expected:** your own project is marked and can't be picked.
- [ ] **V-10** Log in as organizer (or judge@dogfood.local) → Vote tab. **Expected:** "Staff can't vote".
- [ ] **V-11** **Sealed counts:** as organizer, Manage → Voting shows turnout (voters and ballots) but **no per-project counts** while voting is open. Check `GET /api/events/spring-build-sprint/voting/results` → 404 `results_not_published`.
- [ ] **V-12** API: `PUT /api/events/spring-build-sprint/ballot` with a **write API token** (§5.1). **Expected:** 403 `session_required` (tokens can't vote).

### 4.2 Voting modes and settings
Import a copy of the fixtures to get an event with a past deadline and no ballots. As admin: user menu → **Import an event** → choose `data/fixtures.json`, slug `vote-lab` → Check → Import. This also exercises §5.6.
- [ ] **VM-1** vote-lab → Manage → Voting: enable, opens = now, closes = tomorrow, mode **Ballot codes**, 2 votes → Save.
- [ ] **VM-2** Generate 5 codes labelled "hall A" → they're shown once, with a CSV download (codes are stored hashed). Redeem one at `/events/vote-lab/vote?code=…` → ballot. Redeem the same code in another browser → "already been used".
- [ ] **VM-3** Wrong code → "isn't valid". The audit log (Exports → audit.csv) has `vote.code_rejected`.
- [ ] **VM-4** Revoke the "hall A" batch → the unused codes stop working; the used one still has its ballot.
- [ ] **VM-5** Once a ballot exists, try switching the mode. **Expected:** 409 `voting_locked` ("People have already voted…"). Moving the dates still works.
- [ ] **VM-6** Setting `opens` before the submission deadline (on any event) → "Voting opens once the submission deadline has passed".
- [ ] **VM-7** Verified-email mode with allowed domain `example.org`: an address at another domain → "Voting is limited to email addresses from the organizers' allowed domains."

### 4.3 Anti-abuse review (Spring Build Sprint → Manage → Vote review)
- [ ] **AB-1** **High** severity incident: 12 ballots, all for *Portly*. Signals listed: shared /24, burst, fresh accounts, numbered addresses (`dev.hunter01..12`), surge, voted without viewing. Emails are masked (`d***1@outlook.com`).
- [ ] **AB-2** **Low** severity campus incident: 6 ballots, one network signal only. None of the 34 ordinary fans is flagged.
- [ ] **AB-3** Quarantine the ring with reason "ring of throwaway accounts". **Expected:** the ballots are kept but marked quarantined; turnout "counted" drops by 12. Audited as `ballots.quarantined`.
- [ ] **AB-4** Restore one ballot with a reason → it counts again. Dismiss the campus incident with a note → it moves to Resolved; reopen it → back to open.
- [ ] **AB-5** Rate limit (optional, API): more than 30 ballot changes in an hour from one ballot → 429.

### 4.4 Comments (Spring Build Sprint project pages)
- [ ] **CM-1** Logged out: comments are readable, and the form says to log in.
- [ ] **CM-2** As voter: post a comment → it appears. Reply to it → indented. Try replying to a reply → there's no reply button (one level only).
- [ ] **CM-3** Edit your comment → "edited". The earlier text is in audit.csv (`comment.edited`, before/after). After 15 minutes, the Edit button disappears (optional).
- [ ] **CM-4** Post `<script>alert(1)</script>` → shown as literal text, and nothing runs.
- [ ] **CM-5** Post the same text twice → "You've already posted that comment". Post 6 comments within 10 minutes → the 6th is refused.
- [ ] **CM-6** A brand-new account (registered today) posts a link → refused ("new accounts can't post links"). The voter (older account) can.
- [ ] **CM-7** As judge@dogfood.local (judging open) → the comment box says judges can comment after judging closes.
- [ ] **CM-8** Report someone else's comment → "reported". Reporting it again → "already reported". Your own comment has no Report button.
- [ ] **CM-9** Delete your own comment → it's gone; replies to it stay under a placeholder.

### 4.5 Moderation (Manage → Comments)
- [ ] **MO-1** The "Reported" tab shows the Portly spam ("VOTE PORTLY!!!…") with 2 reports.
- [ ] **MO-2** Hide it with a reason → it disappears from the project page. Unhide → it's back. Dismiss the reports → it leaves the queue.
- [ ] **MO-3** Auto-hide: have 3 accounts older than a day report one comment → it's hidden automatically, pending review (`comment.auto_hidden` in the audit log). Reports from brand-new accounts don't count.
- [ ] **MO-4** Comments mode **Read-only** → existing comments are shown and posting is refused. **Off** → no comments section at all.

### 4.6 People's Choice (Sample Hack 2026)
- [ ] **PC-1** The public page shows ranks, with **ties sharing a rank** (e.g. two projects at 5th). There's a "No votes" line for projects with zero votes, and a stats row with voters, votes and **4 ballots set aside**.
- [ ] **PC-2** **Recount:** download `ballots.json`. Count the `picks` of ballots with `"status": "counted"`. **Expected:** it matches the published counts exactly. The page's SHA-256 matches `sha256sum` of the file (or the `X-Content-SHA256` header), and the page says "today's file matches it".
- [ ] **PC-3** **Receipt check:** log in as voter@dogfood.local and open `/events/sample-hack-2026/vote` → note your receipt. On People's Choice → "Check your ballot" → paste it → "counted", with your picks. A made-up receipt → "not found". DevTools: the receipt goes in the request **body**, not the URL.
- [ ] **PC-4** "Did list position matter?" shows a chart and the verdict "no sign of position bias" (χ² below 13.28).
- [ ] **PC-5** As organizer: Manage → Voting → **Unpublish** → the public page shows "not out yet". Quarantine a ballot → allowed. Publish again → the SHA-256 changes, and the public page matches it.
- [ ] **PC-6** While results are published, try to quarantine a ballot → 409 "Unpublish them first".
- [ ] **PC-7** On Spring Build Sprint (voting open): Manage → Exports → `ballots.csv` is listed as unavailable ("sealed until voting closes").

---

## 5. T4: platform

### 5.1 API tokens (User menu → API tokens)
- [ ] **TK-1** Create a read-only token, "CI export", 30 days. **Expected:** it's shown once with Copy, and a curl line. Reload the page: the list shows only the prefix (`dfp_ab12cd…`), never the full token.
- [ ] **TK-2** `curl -H "Authorization: Bearer <token>" localhost:8080/api/auth/me` → your user. The response headers include `RateLimit-Limit: 600` and `RateLimit-Remaining`.
- [ ] **TK-3** Read token → `curl -X PATCH …/api/events/sample-hack-2026 -d '{"tagline":"x"}' -H "Content-Type: application/json"` → **403 `insufficient_scope`**.
- [ ] **TK-4** Create a read-and-write token → the same PATCH works. audit.csv shows the actor as `organizer@dogfood.local (API token "…")`.
- [ ] **TK-5** **Role checks still apply:** a token created by the participant (priya1) → `GET /api/events/sample-hack-2026/progress` → 403. A judge's token → another judge's scores (`/judges/jdg_26/scores`) → 403.
- [ ] **TK-6** **Browser-only actions:** with a write token → `GET /api/auth/tokens`, `PUT …/ballot`, `POST …/comments` → all **403 `session_required`**.
- [ ] **TK-7** Revoke the token → the next request → **401 `invalid_token`** ("revoked"). A made-up `dfp_…` → 401. The list shows the token as revoked.
- [ ] **TK-8** Old-style session bearer still works (the checker uses it): `curl -H "Authorization: Bearer seed-organizer" …/api/auth/me` → organizer.
- [ ] **TK-9** The seeded token `dfp_demo-organizer-read-only` can read `/api/events/sample-hack-2026/export/results.csv`.

### 5.2 OpenAPI and the API reference
- [ ] **OA-1** `GET /api/openapi.json` → `"openapi": "3.1.0"`, and the operation count matches the badge on /developers.
- [ ] **OA-2** /developers: the Guide sections (Authentication, Rate limits, Conventions, Webhooks) render. Open "PATCH /api/events/{slug}/projects/{projectId}": a request-body table with constraints (e.g. `title` 1–120 chars), an access badge, and a curl example.
- [ ] **OA-3** The link `/developers#postAuthTokens` opens that operation directly. Browser-only operations show a "browser only" pill.
- [ ] **OA-4** Paste `docs/openapi.json` into any OpenAPI 3.1 validator or viewer (optional, needs internet) → valid.
- [ ] **OA-5** The "Webhook events" section lists every event type, each with its `data` fields, plus the Node verification snippet.

### 5.3 Webhooks (Spring Build Sprint → Manage → Webhooks)
- [ ] **WH-1** Two endpoints: "Team chat relay" (all events, active) and "CRM sync (down on purpose)" (2 types), with delivered, retrying and failed counts.
- [ ] **WH-2** Open the **down** endpoint: its ping is **Retrying**, with 503 attempts and a "next try" time. Expand it: every attempt shows its status, duration and response ("down for maintenance"). The row refreshes live.
- [ ] **WH-3** Open the healthy endpoint → **Send test** → within about 3 s it shows Delivered 204. http://localhost:9000 shows it **✓ valid**.
- [ ] **WH-4** **A real event:** edit the event tagline (Details & branding) → an `event.updated` delivery arrives at the receiver, ✓ valid, with `data.changed: ["tagline"]`.
- [ ] **WH-5** **Filtering:** the CRM endpoint (subscribed to `project.submitted` and `results.published`) gets **no** `event.updated`.
- [ ] **WH-6** **No ballot events:** cast or change a ballot as a voter → **nothing** arrives at the receiver, even for the all-events endpoint.
- [ ] **WH-7** Add an endpoint `http://169.254.169.254/latest/meta-data` → refused ("private or internal addresses"). The same for `http://localhost:4000`, `http://10.0.0.5` and `http://user:pw@example.org`.
- [ ] **WH-8** Add `https://example.org/hook` → the secret `whsec_…` is shown once, plus a test delivery. Offline, that delivery fails with a DNS error and retries; that's expected.
- [ ] **WH-9** **Rotate secret** on the healthy endpoint → a new secret is shown, and a banner says "old secret valid until …". Send test → the receiver still shows ✓ valid (it knows only the old secret, and both signatures are sent).
- [ ] **WH-10** Expand a delivered item → **Redeliver** → a new row with the **same message id**, marked "redelivery". The receiver shows "✓ valid (duplicate id)".
- [ ] **WH-11** **Switch off** → Send test is disabled. Change the tagline → no delivery is queued. Switch on → works again.
- [ ] **WH-12** As a judge or participant: `GET /api/events/spring-build-sprint/webhooks` → 403.
- [ ] **WH-13** The audit log has `webhook.created`, `webhook.secret_rotated`, `webhook.test_sent` and `webhook.redelivered`, and **never contains a secret**.

### 5.4 Signed records and certificates (Sample Hack 2026)
- [ ] **RC-1** Manage → Certificates: "121 current records", 30 judges and 91 participants. There's no row for a judge with zero submitted reviews.
- [ ] **RC-2** **Re-issue changed records** → "Everything is up to date (121 unchanged)".
- [ ] **RC-3** Open a 1st-place participant's certificate: name, team, project, "1st of 40 · judged results", dates, "Digitally signed", key id, verify URL, QR code. **Print** → one A4 landscape page with no site header or footer. It looks identical in dark mode.
- [ ] **RC-4** Scan the QR (phone on the same machine, or copy the URL) → the verify page.
- [ ] **RC-5** A judge's verify page: review count, tracks, a `sha256:…` **reviews commitment**, and **no scores** anywhere (check "The exact signed text").
- [ ] **RC-6** **Verify it yourself:** `node tools/verify-record.mjs http://localhost:8080/verify/<id>` → ✓ signature valid. Add `--openssl out`, then run the printed `openssl pkeyutl -verify …` → "Signature Verified Successfully".
- [ ] **RC-7** **Forgery:** download "Signed record (.json)", change the name or placement in a text editor, then run the tool on the file → **✗ signature INVALID**, exit code 1.
- [ ] **RC-8** **Revoke** a record with a reason → its verify page shows "Authentic, but revoked" with the reason, and the certificate shows a **REVOKED** watermark. Re-issue does *not* bring it back.
- [ ] **RC-9** **Supersede:** rename a team (or unpublish and republish results) → Re-issue → "Signed 1…, replacing 1". The old verify link shows "Authentic, but superseded" and links to the new one.
- [ ] **RC-10** As a participant: User menu → **My certificates** lists their record with Certificate and Verification link.
- [ ] **RC-11** Spring Build Sprint (judging open) → Certificates → "Available once judging closes", with the button disabled. The API returns 409 `judging_not_closed`.
- [ ] **RC-12** **Tamper-proof (optional, DB):** `docker exec -it dogfood-db-1 psql -U dogfood -d dogfood -c "UPDATE \"SignedRecord\" SET statement='{}' "` → ERROR "a signed record's statement cannot change". `DELETE` → "cannot be deleted".
- [ ] **RC-13** `GET /api/records/keys` lists the current key (`retiredAt: null`). The private key is **not** in the database; it's at `/data/keys/signing-key.pem` in the api container, on the `keys` volume.

### 5.5 Embeddable gallery
- [ ] **EM-1** Manage → Embed: change the theme, track, search and medals options → the preview and the snippet update. Toggle script vs iframe code. Copy works.
- [ ] **EM-2** **Third-party page:** save this as `host.html` somewhere and serve it (`python -m http.server 5500` in that folder):
  ```html
  <h1>My university</h1>
  <script src="http://localhost:8080/embed.js" data-event="sample-hack-2026" async></script>
  <p>Footer right under the gallery?</p>
  ```
  Open http://localhost:5500/host.html. **Expected:** the gallery renders; the footer sits right under it (auto-height, no inner scrollbar); search and track chips work; clicking a project opens the portal in a **new tab**.
- [ ] **EM-3** `data-theme="dark"` → dark gallery on a light host page.
- [ ] **EM-4** **Framing policy:** `curl -I localhost:8080/embed/sample-hack-2026` → `frame-ancestors *`. `curl -I localhost:8080/events/sample-hack-2026` → `X-Frame-Options: DENY` and `frame-ancestors 'none'`. In host.html, add `<iframe src="http://localhost:8080/events/sample-hack-2026">` → the browser refuses to display it.
- [ ] **EM-5** **Anonymous:** while logged in as organizer, the embed shows only submitted projects, the same as logged out (no drafts, no user menu).
- [ ] **EM-6** A non-existent slug → `/embed/nope` → a 404 page, not a crash.

### 5.6 Bulk export and import
- [ ] **IO-1** Manage → Exports → **Full event (.json)**. Open the file: `"format": "dogfood-event/v1"`, 41 projects, 30 judges, people as emails, reviews with scores, and **no** password hashes, ballots or comments.
- [ ] **IO-2** As admin: Import an event → choose that file, slug `copy-1` → **Check the file**. **Expected:** the counts (41 projects, 126 reviews, 0 new accounts, …) and "ran the real import and then rolled it back". Nothing exists yet at `/events/copy-1` (404).
- [ ] **IO-3** **Import** → "Imported", with a link to the organizer console. You are its organizer. Its gallery has 40 projects; the prj_41 duplicate is flagged, not shown.
- [ ] **IO-4** **Round trip:** copy-1 → Manage → Results → compute a run. **Expected:** the same ranking as Sample Hack's published results (same order and scores; tied projects share a rank).
- [ ] **IO-5** Import the same file again with no slug → "An event with the slug … already exists". Slug `import` → "reserved".
- [ ] **IO-6** **Broken file:** edit the export: change one project's `team` to `"nope"`, duplicate a project `ref`, and set a score to 99 → Check. **Expected:** **all** the problems are listed at once, and nothing is imported.
- [ ] **IO-7** A random JSON (`{"hello":1}`) → "Expected a dogfood-event/v1 file … or a DOGFOOD fixtures.json". A non-JSON file → "isn't valid JSON".
- [ ] **IO-8** Import `data/fixtures.json` (slug `fx-1`) → works (source "fixtures"), with the same counts as the seeded Sample Hack.
- [ ] **IO-9** As organizer (not admin): `/events/import` → "Only admins can import events". The API returns 403.
- [ ] **IO-10** Existing people keep their names and passwords: priya1@example.org can still log in with `dogfood2026` and now also sees copy-1 in the user menu.

---

## 6. Security checks for the new surface

| ID | Check | Expected |
|---|---|---|
| SEC2-1 | Every write via a read-only token | 403 `insufficient_scope` |
| SEC2-2 | Token trying to create a token, vote or comment | 403 `session_required` |
| SEC2-3 | Webhook URL pointing at metadata, localhost, 10/8, `[::1]` or embedded credentials | 400, refused |
| SEC2-4 | Webhook secret in list responses, audit log or exports | never present |
| SEC2-5 | Ballot activity on webhooks | never sent |
| SEC2-6 | A portal page framed by another origin | blocked (DENY and `frame-ancestors 'none'`) |
| SEC2-7 | Embed rendered while signed in | shows public data only |
| SEC2-8 | Edited certificate JSON | the verifier and the browser check both fail |
| SEC2-9 | Revoked or superseded record | clearly labelled; can't be un-revoked (DB trigger) |
| SEC2-10 | Import by non-admin; oversized file (more than 25 MB) | 403; 413 |
| SEC2-11 | Receipt lookup | the receipt is in the POST body, never the URL |
| SEC2-12 | Vote counts before close, even for organizers | not available anywhere (page, API, CSV) |
| SEC2-13 | Staff voting, voting for your own project | refused |

---

## 7. Cross-cutting

- [ ] **X-1** **Light, dark and 390 px** on every new page: Vote, People's Choice, comment threads, Manage → Voting / Vote review / Comments / Webhooks (list and detail) / Certificates / Embed, Account → API tokens / My certificates, /developers, /verify, /certificates, /events/import. No clipped text; tables scroll inside their card.
- [ ] **X-2** **Audit log** (Exports → audit.csv) has entries for: `ballot.cast`, `ballots.quarantined`, `comment.edited`, `comment.hidden`, `voting.results_published`, `api_token.created`, `api_token.revoked`, `webhook.*`, `records.issued`, `record.revoked`, `event.imported`, `export.downloaded`. Then `npm run audit:verify` → intact.
- [ ] **X-3** **Offline:** disconnect the network and restart the stack. Everything in §3 still works, except external webhook URLs (expected: DNS failures that retry).
- [ ] **X-4** **Restart safety:** `docker compose restart api`. The same signing key id appears in the log, no duplicate records or webhooks are created, and demo logins still work.
- [ ] **X-5** `SEED_DEMO=false` (set it in docker-compose, then `up -d api`). The log says demo sessions, API tokens and webhooks were removed; `seed-organizer` and `dfp_demo-…` now return 401 or visitor.

---

## 8. Known limits (not bugs)

- T3 and T4 have no checks in the official `run.py`; the checker verifies T1 and T2 only.
- The webhook SSRF guard checks DNS at send time, but a hostile DNS server could still switch answers between the check and the connection (DNS rebinding). It's documented in the threat model.
- The token rate limiter lives in memory: per API process, and reset on restart.
- Rank ties are now shared ("5, 5, 7"). The seeded published run in an **old** database still shows the old split ranks, because runs never change. A fresh stack recomputes them.
- Certificates print through the browser ("Save as PDF"); there is no server-side PDF.
- Imported events bring reviews but not result runs; compute results again after importing.

---

## 9. Suggested split for four (about 45 minutes each)

| Person | Sections |
|---|---|
| 1 | §2 automated, §3 smoke, §4.1 voting, §4.6 People's Choice |
| 2 | §4.2 modes (uses the vote-lab import), §4.3 anti-abuse, §4.4–4.5 comments and moderation |
| 3 | §5.1 tokens, §5.2 OpenAPI, §5.3 webhooks, §6 SEC2-1…5 |
| 4 | §5.4 records and certificates, §5.5 embed, §5.6 import/export, §6 SEC2-6…13, §7 |

AB-3, PC-5, RC-8 and RC-9 change shared state. Run them last, or on separate fresh stacks.
