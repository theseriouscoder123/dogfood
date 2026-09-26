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
