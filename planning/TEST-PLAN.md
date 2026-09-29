# Test plan: everything built so far (T1 + T2)

Covers the participant portal (T1) and the judging engine (T2 phases 1–6). It has three layers:

1. **Automated suites** (§2). Run first; 3 minutes.
2. **Smoke test** (§3). 15 minutes; do it after every rebuild.
3. **Full manual regression** (§4–§8). About 3–4 hours for one person, or about 1 hour each for four people, split as in §10.

Every case has an ID, steps, and an **expected** result. Tick the box when it passes. When one fails, file it with the template in §11.

---

## 1. Setup

### 1.1 Fresh stack (do this before a full run)
```bash
docker compose down -v
```
```bash
docker compose up -d --build
```
Wait for `docker compose ps` to show `api` as healthy. Then open:

| What | URL |
|---|---|
| Portal (through the gateway) | http://localhost:8080 |
| Mailpit (every email the app sends) | http://localhost:8025 |
| API health | http://localhost:8080/api/health |

> **Time matters.** The two demo events use dates relative to **first boot**. The demo jam's submissions close 2 days after boot, and the Spring Build Sprint's judging closes 2 days after boot. If your stack is older than that, reset it with the two commands above.

### 1.2 Seeded accounts (password for all: `dogfood2026`)

| Role | Email | Cookie for API tests | Use it for |
|---|---|---|---|
| Organizer (all 3 events) | organizer@dogfood.local | `sid=seed-organizer` | organizer console |
| Admin | admin@dogfood.local | `sid=seed-admin` | creating events |
| Judge A, sample event (jdg_24) | diego.herrera@example.org | `sid=seed-judge-a` | isolation checks (judging closed) |
| Judge B, sample event (jdg_26) | jonas.vogel@example.org | `sid=seed-judge-b` | isolation checks |
| Judge, Spring Build Sprint | judge@dogfood.local | `sid=seed-judge-demo` | **live scoring** |
| Participant, sample event | priya1@example.org | `sid=seed-participant` | participant views |

### 1.3 The three events

| Event | Slug | State | Use it for |
|---|---|---|---|
| Sample Hack 2026 | `sample-hack-2026` | Finished. Results published by the seed. | fixture checks, results, exports, integrity |
| Dogfood Demo Jam | `dogfood-demo-jam` | **Submissions open** | the whole participant journey |
| Spring Build Sprint | `spring-build-sprint` | **Judging open**, about half done | judge console, progress, stragglers, integrity |

Tip: use one normal browser window plus private/incognito windows so you can be logged in as several people at once.

---

## 2. Automated suites

From `apps/api` (the DB container must be running, because integration tests create and drop their own temporary database):

| ID | Command | Expected |
|---|---|---|
| A-1 | `npm run typecheck` (in both `apps/api` and `apps/web`: `npx tsc --noEmit -p .`) | no output |
| A-2 | `npm test` | **320 passed** (policy matrix, CSV, assignment engine on 200 random events, normalization properties, integrity checks, progress rules) |
| A-3 | `npm run test:integration` | **61 passed** across 6 files |
| A-4 | `npm run audit:verify` | `audit chain intact (N rows)` |
| A-5 | `npm run judging:proof` | writes `docs/normalization-proof.md` in about 20 s. Rerun it: the file is **byte-identical** (`git diff` shows nothing). |
| A-6 | Official checker: `python planning/spec/run.py <your .dogfood.toml> --fixtures data/fixtures.json` | `claimed T1 T2, verified T1 T2`, 7 × PASS |

---

## 3. Smoke test (15 min)

- [ ] **S-1** http://localhost:8080 loads. Three event cards, with no console errors (DevTools).
- [ ] **S-2** Sample Hack 2026 → Projects tab shows 40 projects. "Glass Signal" (prj_01) is present; prj_41 (the duplicate) is **not**.
- [ ] **S-3** Log in as organizer → Manage → every sidebar page opens without an error. The pages are Dashboard, Details, Schedule, Tracks, Prizes, Submission form, Organizers, Rubric, Judges, Assignments, Progress, Integrity, Results and Exports.
- [ ] **S-4** Sample Hack → Results tab (public, logged out) shows a podium and 40 ranked projects.
- [ ] **S-5** Log in as `judge@dogfood.local` → Spring Build Sprint → Judging. The queue shows 3 of 7 submitted. Open a "To review" project, press `7`, wait for "Saved", then reload: the score is still there.
- [ ] **S-6** Toggle the theme (monitor icon, top right): light and dark both look right with no unreadable text. Reload: the choice sticks.
- [ ] **S-7** Mailpit is reachable at http://localhost:8025.

---

## 4. T1: participant portal

### 4.1 Accounts and sessions
- [ ] **AU-1** Register a new account with a password of 7 characters. **Expected:** refused, with a readable message (minimum 8).
- [ ] **AU-2** Register with a valid email and an 8+ character password. **Expected:** logged in; the avatar menu shows your name.
- [ ] **AU-3** Register again with the same email in a different case (`Me@X.com` vs `me@x.com`). **Expected:** "An account with this email already exists."
- [ ] **AU-4** Log out, then log in with a wrong password, then with an unknown email. **Expected:** the *same* generic error both times (no account enumeration).
- [ ] **AU-5** "Forgot password" for your email. **Expected:** an email in Mailpit with a reset link. Set a new password and you're logged in. **Using the same link again fails** (single use), and the old password no longer works.
- [ ] **AU-6** Forgot password for an unknown email. **Expected:** the same "check your inbox" message and no email.
- [ ] **AU-7** Visit `/events/dogfood-demo-jam/team` logged out. **Expected:** you're sent to login, and back to the team page afterwards.

### 4.2 Browsing (logged out)
- [ ] **BR-1** Home page: cards show banner or cover, status pill (Open / Judging / Ended), prize total and participant count.
- [ ] **BR-2** Event page tabs: Overview (Markdown renders headings and lists), Prizes, Rules, Projects. The **Results** tab shows **only** on Sample Hack (published).
- [ ] **BR-3** The countdown on the demo jam ticks every second. The schedule timeline ticks off past dates.
- [ ] **BR-4** Gallery: track filter chips and search both narrow the list; an empty search shows an empty state, not an error.
- [ ] **BR-5** A project page shows the story, "Built with" tags, repo/demo links and the team. **Private** answers to organizer questions are **not** shown when logged out or logged in as another participant.
- [ ] **BR-6** `/events/does-not-exist` and `/events/sample-hack-2026/projects/<random-uuid>` show the 404 page, not a crash.

### 4.3 Registration and teams (demo jam)
- [ ] **TM-1** Logged in as a new user: Demo Jam → "Register" → you become a participant, and the sidebar button changes to "Find or create a team".
- [ ] **TM-2** Create a team. **Expected:** you're the captain, and an invite link is shown.
- [ ] **TM-3** Open the invite link in a private window as a *second* new user → join. **Expected:** both members listed.
- [ ] **TM-4** Invite by email → the email is in Mailpit → the link lets the recipient join.
- [ ] **TM-5** Fill the team to the event's max size (4), then try a 5th join. **Expected:** "team full".
- [ ] **TM-6** A member of team A opens team B's invite link. **Expected:** refused (one team per person per event). Reopening *your own* team's link just says you're already a member.
- [ ] **TM-7** Revoke an invite link, then open it. **Expected:** invalid/expired.
- [ ] **TM-8** Duplicate team names across different teams are allowed (the fixture has 3), and the gallery still distinguishes them.

### 4.4 Submissions (demo jam)
- [ ] **SB-1** Start a project. The editor's checklist shows which required fields are missing: title, tagline, description, repo, track, and required custom questions.
- [ ] **SB-2** Save a draft with half the fields. **Expected:** saved and **not** in the public gallery.
- [ ] **SB-3** Submit with a required field missing. **Expected:** refused, and the missing fields are named.
- [ ] **SB-4** Complete everything and submit → the project appears in the gallery. Editing is still allowed; blanking a required field on a submitted project is refused.
- [ ] **SB-5** Upload a thumbnail PNG/JPEG. **Expected:** shown. Upload a `.svg`, a `.txt` renamed to `.png`, and a file over 5 MB. **Expected:** all three refused.
- [ ] **SB-6** Answer the custom questions (single select, long text, checkbox). The private checkbox answer is visible to you and to the organizer, **not** to the public (see BR-5).
- [ ] **SB-7** Unsubmit (back to draft), then withdraw. **Expected:** the project disappears from the gallery each time. A withdrawn project can be restored while submissions are open.
- [ ] **SB-8** **Deadline enforcement:** as an organizer, move the demo jam's submission close to 1 minute from now; wait for it to pass. As the participant, try to edit and to submit. **Expected:** both refused (server clock, not the UI). Organizer → audit.csv shows `submission.refused_closed` rows. *(Put the date back afterwards.)*
- [ ] **SB-9** Sample Hack (closed) as `priya1@example.org`: the project can't be edited; the API returns 403/409 (checker T1-3).

### 4.5 Organizer: event setup
- [ ] **OR-1** Details and branding: upload a banner and a logo → they appear on the event page, home card and manage sidebar.
- [ ] **OR-2** Edit the overview and rules (Markdown) → the public page renders them.
- [ ] **OR-3** Schedule: put the submission close *before* the open time. **Expected:** refused with a clear message. Valid changes update the countdown and timeline.
- [ ] **OR-4** Tracks: add, rename, delete. Prizes: add an overall prize and a track prize, then edit a value → the prize total on the card updates.
- [ ] **OR-5** Submission form: add one question of each type, reorder, mark one private and one required → the project editor reflects this immediately.
- [ ] **OR-6** Organizers: add a co-organizer by email → they can open Manage. Non-organizers get 403 or a redirect on every `/manage/*` URL.
- [ ] **OR-7** As **admin**: create a new event via "Create event". As a regular user: the create page is refused (only admins create events).
- [ ] **OR-8** Dashboard: the setup checklist ticks items off as you complete them.

---

## 5. T2: judging engine

### 5.1 Rubric (Manage → Rubric)
- [ ] **RB-1** Demo jam (no scores yet): add, edit, reorder and delete criteria; set a 1–10 range on one. The weight sliders show each criterion's share.
- [ ] **RB-2** Sample Hack (378 scores exist): the page shows "locked". Try to change a score range or delete a criterion → refused (`rubric_locked`). **Changing a weight or label works**, and audit.csv has `rubric.weights_changed`.
- [ ] **RB-3** After RB-2, Results → the preview ranking changes (weights apply at compute time), and a *saved* run is now marked **stale**.

### 5.2 Judges and conflicts (Manage → Judges)
- [ ] **JG-1** Invite a brand-new email as a judge with one track. **Expected:** a "Set up my account" email in Mailpit; the link sets a password and logs in as a judge.
- [ ] **JG-2** Invite someone who is a **participant** in the same event. **Expected:** refused (`judge_conflict`). Likewise, a judge can't register as a participant.
- [ ] **JG-3** Change a judge's tracks so an existing assignment falls outside them. **Expected:** refused (`judge_has_assignments`).
- [ ] **JG-4** Remove a judge who has submitted reviews. **Expected:** refused (`judge_has_reviews`), pointing to "exclude from results".
- [ ] **JG-5** Add a conflict of interest (judge ↔ team). **Expected:** the response lists affected assignments; the Assignments page marks them; auto-assign never pairs them (A-2 also covers this).

### 5.3 Assignments (Manage → Assignments)
- [ ] **AS-1** Demo jam (submissions still open): Preview works, but **Commit is disabled** with an explanation.
- [ ] **AS-2** Sample Hack: Preview "fill to 3 per project". **Expected:** the summary shows new assignments for the 8 projects that only have 2 reviews, load stats, and **1 connected group**.
- [ ] **AS-3** Preview "simulate from scratch". **Expected:** judge load about 2–7 with lower spread, compared with the fixture's own 1–11.
- [ ] **AS-4** Same seed twice → identical preview. A different seed → a different but equally valid plan.
- [ ] **AS-5** **Stale preview:** preview, then in another tab add a conflict or a judge, then Commit. **Expected:** 409 "Preview again".
- [ ] **AS-6** Commit → a history row with algorithm, seed and count. Coverage shows 3 per project.
- [ ] **AS-7** Manual add: the judge picker greys out ineligible judges *with the reason* (already assigned / conflict / different track / recused).
- [ ] **AS-8** Reassign an unstarted assignment. Try to delete or reassign a **submitted** one → refused.

### 5.4 Judge console (Spring Build Sprint as judge@dogfood.local)
- [ ] **JC-1** Judging dashboard: a greeting, a progress bar (3/7), a countdown to close, and groups To review / In progress / Submitted.
- [ ] **JC-2** Open a project: story on the left, sticky scoring panel on the right, weights shown per criterion.
- [ ] **JC-3** **Keyboard:** focus starts on the first *unscored* criterion. Digits score it (`0` = 10 on 1–10 rubrics), ↑/↓ move between criteria, and the composite updates live.
- [ ] **JC-4** Autosave: score two criteria, wait about a second → "Saved". Close the tab and reopen → the draft is kept; the dashboard shows "Draft saved".
- [ ] **JC-5** Submit with a criterion missing. **Expected:** refused, naming the missing criterion.
- [ ] **JC-6** Complete and "Submit & next" → it jumps to the next *unscored* project; progress becomes 4/6.
- [ ] **JC-7** Revise a submitted review → allowed while judging is open; the audit log has `review.revised` with before/after.
- [ ] **JC-8** Recuse from a project with "declare a conflict". **Expected:** it moves to Recused and the draft is deleted. Organizer → Judges shows the new conflict, and auto-assign never gives that team back.
- [ ] **JC-9** **Isolation (critical):** copy the assignment URL from judge A. Open it as judge B (another window) → **404**, not 403. Same through the API: `curl -H "Cookie: sid=seed-judge-b" localhost:8080/api/events/sample-hack-2026/judging/<A's id>` → 404.
- [ ] **JC-10** Sample Hack judges (judging closed): everything is read-only, and trying to save via the API → `judging_closed`.
- [ ] **JC-11** An organizer or participant opening `/events/<slug>/judging` gets "You're not judging this event".

### 5.5 Progress (Spring Build Sprint → Manage → Progress)
- [ ] **PR-1** Tiles show about 29/44 reviews, 3/8 judges finished, and **2 judges behind** (Eli: not started; Dana: behind).
- [ ] **PR-2** The chart's submitted line sits against the dashed steady-pace line, with a "now" marker.
- [ ] **PR-3** Live: score a review as judge@dogfood.local in another window. Within 15 s the counts and chart update **without a reload**. The indicator says "Live · updated Xs ago".
- [ ] **PR-4** Remind Eli → the email arrives in Mailpit with the count and deadline. Remind again → skipped ("already reminded in the last 6 hours"); the button shows "Reminded …".
- [ ] **PR-5** Redistribute Eli → the preview lists each untouched project → new judge, **never** a judge with a conflict or a different track. Confirm → Eli has 0 assignments, and a "Redistributed from Eli Navarro" batch appears in Assignments history.
- [ ] **PR-6** Stale redistribution: preview for Dana, then as Dana (or via the DB) start a review, then confirm → 409, and her started work is untouched.
- [ ] **PR-7** "Projects that need attention" lists projects waiting on stragglers or under-assigned (e.g. the one Gus recused from).
- [ ] **PR-8** At phone width the judges table scrolls **inside** its card and the page doesn't scroll sideways.

### 5.6 Results and normalization (Manage → Results)
- [ ] **RS-1** Sample Hack opens on the **published** run. Tiles: 40 ranked, agreement ρ ≈ 0.96, noise ±0.70, 1 judge group.
- [ ] **RS-2** The table shows rank arrows vs raw, raw vs adjusted, an interval bar, likely rank (#1–18 for #1), top-k %, and flags (provisional ×8, duplicate for prj_41 at the bottom, unranked).
- [ ] **RS-3** Fixture sanity: #1 prj_34 Iron Switch; prj_10 Still Beacon at #6 (was #3, provisional).
- [ ] **RS-4** Judges tab: jdg_02 and jdg_15 generous, jdg_10 harsh, jdg_07 "same score for everything".
- [ ] **RS-5** Exclude a judge: a reason is required (a short one is refused) → a live preview shows the rank changes; nothing is saved until "Save as a run".
- [ ] **RS-6** Save a run → it appears under Saved runs with its fingerprint. Two saves with the same inputs have the **same fingerprint**.
- [ ] **RS-7** Spring Build Sprint (judging open): Publish is **locked** with an explanation.
- [ ] **RS-8** Stale run: save a run, then change a weight (RB-2) or revise a review → the run shows "data changed since" and Publish is refused (`stale_run`).
- [ ] **RS-9** Unpublish on Sample Hack → the public Results tab disappears. Publish again → it's back. The audit log shows `results.unpublished` and `results.published`.
- [ ] **RS-10** Public results: podium with prize names, track chips re-rank within the track, and `?track=garbage` falls back to Overall. The page source/JSON contains **no** judge names, offsets or raw scores.
- [ ] **RS-11** "Proof report" downloads a Markdown file with the ranking table, judge leniency, the simulation tables and the integrity section.
- [ ] **RS-12** Immutability (optional, needs `psql`): `UPDATE "ProjectResult" SET rank = 1;` → the database raises "immutable snapshot".

### 5.7 Integrity (Manage → Integrity)
- [ ] **IN-1** Spring Build Sprint shows **exactly** the planted problems:
  - Gus's outlier (all 1s)
  - Ava's "Didn't run for me…" on a high score
  - Farah: consistently fast, same score on every criterion, scores barely vary, and 3 rushed reviews

  It also shows the "judges barely agree" warning.
- [ ] **IN-2** Sample Hack shows jdg_04 opposite to the panel (r = −0.99), the jdg_04/prj_37 outlier, 4 comment mismatches ("Docs are thin." on high scores, including jdg_15/prj_34), and jdg_07's halo and flat scores. It shows **no** copy-paste flags, and "Reviews with timing" is 0%.
- [ ] **IN-3** "Looks fine" with an empty note → refused. With a note → it moves to "Decided" with your name and time. Reopen → back to Open. The audit log has `integrity.flag_resolved` and `integrity.flag_reopened`.
- [ ] **IN-4** "Exclude judge…" opens Results with the exclusion dialog already open for that judge.
- [ ] **IN-5** Judges and participants: `/api/events/<slug>/integrity` → 403. Judges never see flags anywhere in their console.

### 5.8 Exports (Manage → Exports)
- [ ] **EX-1** Eight files with row counts. Sample Hack: participants 91, teams 40, projects 41, judges 30, assignments 126, reviews 378, results 41.
- [ ] **EX-2** Open each file in Excel or LibreOffice: names with accents are correct (UTF-8 BOM), and comments containing commas stay in one cell.
- [ ] **EX-3** Formula injection: set a project title to `=HYPERLINK("http://x","click")`, export projects.csv, open it in a spreadsheet → shown as text starting with `'`, **not** a link.
- [ ] **EX-4** results.csv says `published run <id>` when published, and `live (not published)` after unpublishing.
- [ ] **EX-5** Every download adds an `export.downloaded` row to audit.csv.
- [ ] **EX-6** As a participant or judge, `/api/events/sample-hack-2026/export/reviews.csv` → 403.

---

## 6. Security and permissions

Run these with `curl` or the browser's DevTools. Swap the cookie per role.

| ID | Request | As | Expected |
|---|---|---|---|
| SEC-1 | `GET /api/events/sample-hack-2026/judges/jdg_26/scores` | judge_a | 403/404 (peer scores; checker T2) |
| SEC-2 | same | participant | 403 |
| SEC-3 | `GET …/progress`, `…/integrity`, `…/normalization`, `…/export` | judge, participant | 403; logged out → 401 |
| SEC-4 | `PUT …/judging/<peer assignment>/review` | judge_b | 404 |
| SEC-5 | `POST …/normalization/runs/<id>/publish` | co-organizer of a *different* event | 403 |
| SEC-6 | Change `sid` to a random value | anyone | treated as logged out (401 on protected routes) |
| SEC-7 | Upload an HTML file renamed `.png` | participant | refused (type is read from the file's bytes) |
| SEC-8 | `GET /api/files/<uploaded>` | anyone | `X-Content-Type-Options: nosniff` and a restrictive CSP header |
| SEC-9 | 61 uploads within one hour | participant | the 61st gets 429 |
| SEC-10 | Try to edit the audit log with `psql` (`UPDATE "AuditLog" …`) | DB | refused by trigger. After any manual DB tampering, `npm run audit:verify` reports the broken link. |

---

## 7. Cross-cutting

- [ ] **UX-1 Themes:** go through every page in both light and dark. Watch for low-contrast text, white boxes in dark mode, and invisible chart lines.
- [ ] **UX-2 Phone width (375–390 px):** home, event hub, gallery, project page, editor, team, judge scoring, and all manage pages. The page must never scroll sideways; wide tables scroll inside their card.
- [ ] **UX-3 Browsers:** Chrome, Firefox, Safari or Edge. Pay attention to the date inputs on Schedule and the countdown.
- [ ] **UX-4 Keyboard only:** tab through login, register, editor and scoring. Focus rings are visible and Escape closes dialogs.
- [ ] **UX-5 Empty states:** a new event with no tracks, prizes, projects or reviews shows helpful empty states, not errors or blank cards.
- [ ] **OFF-1 Offline:** disconnect from the internet, then `docker compose down -v && up -d --build` (with images already pulled). **Expected:** the stack starts and seeds; fonts load; email goes to Mailpit. There should be no requests to external hosts (DevTools → Network).
- [ ] **OFF-2 Restart safety:** `docker compose restart api`. **Expected:** the seed is idempotent. No duplicate events or users; the published results and your decisions survive.
- [ ] **AUD-1** After a full run, `npm run audit:verify` → the chain is intact.

---

## 8. Data sanity against the fixtures

| Check | Expected |
|---|---|
| Projects in gallery | 40 (prj_41 hidden as the duplicate of prj_07) |
| Judges / tracks / reviews imported | 30 / 8 / 126 (122 counted in results) |
| Duplicate team names | 3, all imported |
| Judge–project graph | 1 connected component |
| `docs/normalization-proof.md` headline | additive ρ ≈ 0.805 > raw ≈ 0.773 > z-score ≈ 0.747 |
| Reliability | ICC ≈ 0, with the "barely agree" warning. This is **expected**: the fixture scores look random. |

---

## 9. Known limits (not bugs)

- Demo dates are relative to first boot, so a stack older than 2 days has stale demo states. Reset it.
- Rank uncertainty treats projects as independent, so it's an approximation (documented in the code and the report).
- Integrity flags are advice; they never change results on their own.
- T3 and T4 (voting, comments, People's Choice, API tokens, webhooks, certificates, embed, import/export) are covered in `TEST-PLAN-2.md`.

---

## 10. Suggested split for a team of four (about 1 hour each)

| Person | Sections |
|---|---|
| 1 | §2 automated, §3 smoke, §4.1–4.2 accounts and browsing, §7 UX-1/UX-2 |
| 2 | §4.3–4.5 teams, submissions and organizer setup, SEC-6…SEC-9 |
| 3 | §5.1–5.4 rubric, judges, assignments, judge console (JC-9 isolation is critical), SEC-1…SEC-5 |
| 4 | §5.5–5.8 progress, results, integrity, exports, §7 OFF/AUD, §8 data sanity |

Each person starts from a fresh stack (§1.1) or coordinates, because PR-5 and RS-9 change shared state.

---

## 11. Bug report template

```
ID / area:        (e.g. JC-4, judge console autosave)
Build:            git commit hash, fresh stack? (y/n)
Account:          (e.g. judge@dogfood.local)
Browser / width:  (e.g. Firefox 131, 390px, dark)
Steps:            1. … 2. … 3. …
Expected:         (copy from this plan)
Actual:           (include the error text and HTTP status from DevTools → Network)
Screenshot/log:   (docker compose logs api --tail 50 if the API errored)
```
