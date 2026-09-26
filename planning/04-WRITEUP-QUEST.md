# Write Up Quest: research and plan

## Rules (from dogfoodhack.com and the spec's context.txt)
- **Prize:** $100 for each of the top 4 write-ups. Optional, and it doesn't affect your main score.
- **Where:** any developer-focused platform: dev.to, X, LinkedIn, Hashnode, or your own blog.
- **Tags:** tag **Hackathon Raptors** (the homepage) and **#DogfoodHackathon** (the spec context file). Use both. Earlier Raptors write-ups on dev.to use the tag `#hackathonraptors`.
- **Deadline: 5 Oct 2026, 18:00 UTC (23:30 IST).** You can start writing from kickoff. Winners are announced 9 Oct.
- **Judged on insight and technical substance, not follower count.** Topics they explicitly invite:
  - schema rework
  - normalization maths
  - role-isolation bugs
  - features you cut
  - designs you abandoned
  - "the part where the spec was harder than it looked"
- **Ask on Discord:** can each team member submit their own write-up? If so, 3–4 teammates can cover different angles and take multiple shots at the 4 prizes.

## What earlier Raptors write-ups looked like (Zero Dependency 2026, on dev.to)
Winners for that event hadn't been published when I checked (25 Sep), so these are patterns in the visible entries, not confirmed winners:
- **Long and technical:** roughly 4,000+ words, with section headings that mirror the organizer's suggested topics.
- **They lead with an uncomfortable number.** One opened with a benchmark where the author's tool was 5–6× slower than established tools. Another showed the number of files it could migrate dropping from 40 to 11 after the bugs were fixed.
- **Plenty of evidence:** tables, code snippets, real command output, and reproducible hashes.
- **A dedicated limitations section,** plus "what I'd do differently".
- Titles state an insight rather than a product name. One example: "Signature Equality Is Not Behavioural Equality".

## Our candidate angles (the strongest first)
1. **"The textbook normalization made our rankings worse"**: z-score vs the additive shrinkage model on the fixture graph, the simulation, the flat judge and the duplicate that judges scored differently. This matches the organizers' own interest most closely: they point out that platforms advertise normalization and never document it.
2. **"Hiding a button is not refusing a request"**: building role isolation as a policy layer, the matrix tests, and any isolation bug found during the event (log it!).
3. **"One command, network off"**: every offline trap we hit (fonts, Prisma engines, telemetry, the email catcher).
4. **"Signed judge records with nothing but node:crypto"**: Ed25519, key rotation, and public verification.

## Workflow
1. During the event, log to `BUILD-JOURNAL.md` with real numbers, error text and timestamps.
2. After the freeze (Tue 29 Sep → Sat 3 Oct), I draft from the journal, git history and the proof output, in your voice. You edit it.
3. Publish by **Sun 4 Oct**, with a day of buffer before the 5 Oct 23:30 IST cutoff. Link the repo and the normalization proof.
