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
