# Judging

How a pile of 1–5 scores becomes a ranking you can defend: what the portal does, why, the evidence that it helps, and where it stops helping.

## Summary

- Judges score their own assignments on a weighted rubric. They cannot see anyone else's scores, reviews, rankings or comparisons. **The API enforces this**, not the page.
- Each review becomes one number from 1 to 5. The ranking comes from a model that estimates each judge's leniency from the projects they share with other judges and removes it, **with shrinkage** so small samples aren't over-corrected.
- **Evidence.** In a simulation on this event's real judge–project graph, the model recovers the true order better than raw averages (ρ 0.806 vs 0.788) and much better than per-judge z-scores (0.747). When judges are perfectly fair, it costs 0.022 ρ.
  - Full proof: [docs/normalization-proof.md](docs/normalization-proof.md)
  - Regenerate it with `npm run judging:proof`.
- **Uncertainty is shown, not hidden.** Every project gets a 90% rank range and a chance of finishing in the top k. Projects the data can't separate share a rank.
- **Integrity checks** flag reviews for a person to look at: outliers, rushed reviews, comments that contradict scores, judges who oppose the panel. They never change a score by themselves.
- **Results are immutable snapshots.**
  - A run is fingerprinted, can't be edited (database trigger), and can only be published after judging closes, and only while it still matches the data.
  - Excluding a judge needs a written reason, which is stored in the run and the audit log.
- **Head to head** is optional. Judges pick the stronger of two projects, and a Bradley–Terry model gives a second, scale-free ranking to check the rubric against.
- **Honest limit:** on the official fixture data, judges agree with each other about as much as chance (reliability ≈ 0). No method can create signal that isn't in the scores. The portal says so, on the Integrity page and in the normalization report, instead of implying a confident top 3.

Everything below names the file that implements it and the test that checks it.

---

## 1. From rubric to one number per review

`apps/api/src/judging/composite.ts`

The organizer sets criteria. Each has a weight and its own scale, for example 1–5 or 0–10. A review's composite:

```
composite = 1 + 4 × Σ wᵢ · (xᵢ − minᵢ)/(maxᵢ − minᵢ)  /  Σ wᵢ
```

Each criterion is rescaled to [0, 1] by its own range, averaged with the weights, and shown on a 1–5 scale. Weights are read when results are computed, so re-weighting never means re-scoring.

Once anyone has scored, the rubric's structure freezes: no adding or removing criteria and no changing scales, so nobody can change what earlier scores meant. Weights and labels stay editable, because weights are applied at compute time. The test is `integration/judging-setup.test.ts`. The database also checks every score against its criterion's range with a trigger (`review_score_check` in the first migration).

## 2. Assignment

`apps/api/src/judging/assign.ts` · `unit/assign.test.ts` (including "hard constraints hold on 200 random events")

Assignment is a pure function. The organizer previews a plan and commits it. The commit recomputes the plan and refuses if anything changed since the preview.

**Hard constraints (never broken):**
- a judge only reviews projects in their tracks;
- no conflicts of interest;
- no judge–project pair twice;
- a recused pair is never re-assigned;
- an optional cap on reviews per judge.

**Soft goals, in order:**
1. Every project reaches *k* reviews. When that's impossible, the shortfall is reported.
2. Balanced load.
3. **Connectivity:** prefer judges from a different component of the judge–project graph. Leniency can only be compared between judges who are linked by shared projects, so the assigner deliberately builds those links.
4. Diversity of co-reviewers.
5. A seeded tie-break, so the same seed always gives the same plan.

On the fixture, the graph is one connected component, so every judge's leniency is comparable with every other judge's.

## 3. What a judge can see

`apps/api/src/routes/judgeConsole.ts` · `integration/judge-console.test.ts` · `integration/access-matrix.test.ts` · checker T2

- **Only their own work.** Every judge query filters on `judgeId = the caller`.
  - Another judge's assignment is a **404**: indistinguishable from one that doesn't exist, so it can't be probed.
  - Another judge's scores (`/judges/<ref>/scores`) are a **403**.
- **No panel data at all.** Judges never receive other reviews, averages, rankings or comparisons.
  - The head-to-head pair picker uses only the judge's own scores and comparison *counts*, so even the pairs shown reveal nothing about the panel (§8).
  - A judge calling the organizers' head-to-head report gets 403.
- **Deadlines and recusal.**
  - A submitted review can be revised until judging closes, and every revision is audited with before and after values.
  - A judge can recuse themselves from an assignment (optionally declaring a conflict), but not after submitting a review of it.

## 4. Normalization

`apps/api/src/judging/normalize.ts` · `unit/normalize.test.ts`

### The model

```
x_jp = μ + a_p + b_j + ε
```

- `x_jp` is judge *j*'s composite for project *p*;
- `a_p` is project quality, which is what we rank on;
- `b_j` is judge leniency (positive = generous);
- `ε` is noise.

It's estimated by ridge regression:

```
minimize  Σ (x_jp − μ − a_p − b_j)²  +  λ_j Σ b_j²  +  λ_p Σ a_p²
```

with λ_j = 2 and λ_p = 0.5. This is the same as the best linear unbiased predictor of a random-effects model where λ = σ²_noise / σ²_effect.

- **Solver:** coordinate descent. Each step is the exact minimum for one block, so the objective falls every step and converges to its unique minimum.
- **Deterministic:** no random start, and rows are sorted before fitting. The same data always gives the same numbers.

### Why shrinkage and not z-scores

Most judges review 3 to 6 projects.
- A standard deviation from three numbers is mostly noise, and a judge who gives everything the same score divides by zero.
- Shrinkage handles small samples directly: a judge with *n* reviews can move their own offset by at most n/(n+λ_j) of their average deviation.
- So a judge with one harsh review gets a small correction, not a large one.

### Uncertainty and ties

- **Standard error** for each project: σ/√(n + λ_p).
- **Rank ranges:** 2,000 seeded draws from N(score, se²) give each project's 5th–95th percentile rank and its chance of finishing in the top *k* (k = the number of overall prizes, at least 3).
- **Ties:** projects the data can't separate (same score, same number of reviews) share a rank ("5, 5, 7"). Splitting them by id would be arbitrary, and would change after an export and re-import.

### Flags on a result

These are shown to the organizer and stored in the run.

| Flag | Meaning |
|---|---|
| `provisional` | Fewer reviews than the target (the review count from the last auto-assign, default 3) |
| `disconnected` | The project's judges share no projects with the main group, so its leniency adjustment isn't comparable |
| `duplicate` | Flagged duplicate of another submission. Not ranked |
| `no_reviews` | Nothing to rank on |
| judge `low_sample` | Fewer than 3 reviews |
| judge `low_discrimination` | Standard deviation below 0.25: the judge barely varies |
| judge `generous` / `harsh` | Estimated leniency ≥ +0.25 or ≤ −0.25 |

An organizer can **exclude a judge** from a run. It needs a written reason (at least 5 characters), which goes into the run and the audit log.

## 5. Evidence

Everything here comes from [docs/normalization-proof.md](docs/normalization-proof.md). It was generated by `cd apps/api && npm run judging:proof`, with seed 20260928 and 300 simulated events per scenario, and it reproduces exactly.

**The setup.** We keep this event's *exact* judge–project pairs and simulate events on them:
- true quality ~ N(0, 0.5);
- leniency ~ N(0, 0.4);
- noise ~ N(0, 0.5);
- scores rounded and clamped like real rubric scores.

Then each method tries to recover the true order.

| Method | Mean ρ vs truth | 10th percentile ρ | Picks the true winner | True top 5 found |
|---|---:|---:|---:|---:|
| Raw average | 0.788 | 0.691 | 37% | 60% |
| Per-judge z-score | 0.747 | 0.637 | 29% | 53% |
| **Additive + shrinkage (ours)** | **0.806** | **0.720** | **40%** | **61%** |

- **Fair judges:** with zero leniency, raw averages score 0.851 and ours 0.829, so the insurance costs 0.022 ρ. Z-scores score 0.745 even then.
- **λ_judge:** the result barely moves across 0.5–8 (ρ 0.805, 0.808, 0.806, 0.799, 0.792), so the default isn't a fragile choice.
- **Unit tests** (`unit/normalize.test.ts`) check the basic guarantees directly:
  - recovering planted leniency;
  - no change when judges are fair;
  - determinism;
  - behaviour on the official fixtures.

### What it does on the official fixture

- 40 projects are ranked from 122 reviews by 30 judges. The 4 reviews of the duplicate prj_41 are left out.
- The graph is **one connected component**.
- The raw and adjusted rankings agree at Spearman ρ = 0.969, and 31 projects move, mostly by one or two places.
- Detected leniency ranges from **+0.44** (jdg_02, generous) to **−0.47** (jdg_01, harsh, with one review, so heavily shrunk).

**Reliability.** ICC(1) for a single review, and ICC(1,k) for the average of about 3 reviews, are both **0.000** on this data. The fixture's scores look close to random, so the honest reading is that close ranks are ties. When ICC(1,k) is below 0.5, the Integrity page and the normalization report say so in plain words.

### Fixture edge cases

| In the data | What happens |
|---|---|
| prj_07 and prj_41 "Dry Harbour": same team, same title, both scored | The later one is flagged `duplicate` at import (same team and same repository or title) and left out of the ranking; its reviews aren't counted |
| jdg_07 gives every criterion a 4 | Flagged `low_discrimination` and `identical_criteria`. Leniency is still estimated and removed |
| jdg_01 and jdg_23 have one review each | Flagged `low_sample`. Shrinkage keeps their offsets small, and nothing divides by a zero spread |
| 8 projects with only 2 reviews | Ranked, but flagged `provisional`, with visibly wider rank ranges |

## 6. Integrity checks

`apps/api/src/judging/integrity.ts` · `unit/integrity.test.ts` · `integration/integrity.test.ts`

These are deterministic statistics that point an organizer at reviews worth a second look. **A flag never changes a score.** The organizer dismisses it or acts on it (for example, by excluding a judge with a reason), and the decision is audited and sticks across recomputation.

| Check | Fires when |
|---|---|
| `outlier` | A review is 2.5+ standard deviations from what this judge's habits and the other reviews predict |
| `comment_mismatch` | Negative words on a score ≥ 4.25, or positive words on ≤ 2.25 (a small fixed word list) |
| `identical_criteria` | A judge gives every criterion the same value in 75%+ of their reviews (halo effect) |
| `low_discrimination` | A judge's scores have a spread under 0.25 over 3+ reviews |
| `disagrees_with_panel` | Over 4+ shared projects, correlation with the other judges is ≤ −0.3 |
| `rushed` / `fast_reviewer` | A review submitted within 60 s of opening the project, or a median under 120 s |
| `copy_paste` | The same comment of 25+ characters on 3+ projects |

On the fixture, this finds:
- jdg_04 running opposite to the panel (r = −0.99);
- four high scores with negative comments;
- jdg_07's identical criteria;
- one outlier.

## 7. Results runs and publishing

`apps/api/src/judging/results.ts`, `routes/results.ts` · `integration/results.test.ts`

- **A run is a saved snapshot:** options, every project's score and rank range, and every judge's statistics.
  - Database triggers refuse any UPDATE or DELETE on runs and their rows (`20260927062400_results_immutable`).
  - To change a result, you save a new run.
- **Fingerprint.** Each run stores a SHA-256 of everything that can change the result: every submitted score, rubric weights and ranges, which projects count, and the options. Names are left out, so renaming a project doesn't make a run stale.
  - If the data moves on, the run shows as **stale**, and it can't be published.
- **Publishing** is possible only after judging closes, and only for a non-stale run. Before that, `/results` returns 404 `results_not_published`, even if you guess the URL.
- **Signed placements.** Participant certificates and judge records are signed after judging closes, and the certificate names the published run's id and method. Anyone can check them at `/verify/<id>` or offline with `node tools/verify-record.mjs`.
- **Report.** `GET /normalization/report.md` produces the event's own version of the proof: method, raw vs adjusted ranking, judge effects and integrity findings.

## 8. Head to head

`apps/api/src/judging/pairwise.ts` · `unit/pairwise.test.ts` · `integration/pairwise.test.ts`

### Why it's there

A 1–5 score carries the judge's personal scale; "is A or B stronger?" doesn't. Leniency cancels out by construction. It's also easiest to answer exactly where rubric scores stop separating projects. So it runs **beside** the rubric, as a second opinion the organizer can compare against. The organizer turns it on per event.

### What judges see

- **Pairs:** two of their *own* live assignments. Recused, withdrawn and duplicate projects are left out.
- **Answers:** "left is stronger", "too close to call" or "right is stronger", also from the keyboard. Each pair is compared once per judge.
- **How the next pair is picked:**
  - prefer pairs the judge's own rubric scores barely separate (or hasn't scored);
  - weight toward projects with few comparisons so far, using counts only.
  - It never looks at anyone's verdicts, so a judge learns nothing about the panel.
- **Left or right:** decided by a hash of the judge and the pair. It's stable for that judge and carries no meaning.
- **Database rules:**
  - both sides of a comparison must be the judge's own assignments (composite foreign keys);
  - a CHECK refuses comparing a project with itself;
  - there's a unique key per judge and pair.

### The model

**Bradley–Terry:** P(i beats j) = γᵢ/(γᵢ+γⱼ). A tie counts as half a win each way.
- **Fitting:** Hunter's MM algorithm, which increases the likelihood at every step.
- **The prior:** plain maximum likelihood breaks when a project never loses (its strength goes to infinity) or when comparisons form separate islands. So every project also gets one virtual win and one virtual loss against a fixed anchor of strength 1. That keeps every estimate finite and on one scale.
- **Output:** ratings on the Elo scale (400 points = 10:1 odds, average 1500) with a Fisher-information standard error, and 90% rank ranges from the same simulation the rubric uses.

### What the organizer gets

- The pairwise ranking beside the rubric rank.
- Spearman agreement between the two.
- Projects the two methods place far apart: at least 3 places, or 20% of the field, once a project has 4+ comparisons.
- **Position bias:** a two-sided binomial test of whether the left side wins more than 50%. It's flagged at |z| ≥ 2.58 with 20+ decided comparisons.
- **Each judge's agreement with the panel,** measured against a model refitted *without* that judge, so nobody gets credit for agreeing with themselves. A judge is marked **against the panel** only when a one-sided binomial test says siding with the panel that rarely is unlikely by chance (p < 0.05). A judge makes about ten comparisons, and at that size a plain "under 50%" cut-off flags honest judges: 3 agreements out of 9 happens by chance about a quarter of the time, while 1 out of 11 doesn't.
- `comparisons.csv`.

### Evidence

- **Unit tests** check that the fit:
  - recovers the true order from noisy simulated panels (ρ > 0.9);
  - keeps an unbeaten project finite and first;
  - stays on one scale when the graph is disconnected;
  - treats ties symmetrically;
  - is more certain about projects with more data.
- The pair picker never repeats a pair and is deterministic.
- **On the seeded demo event**, measured on three fresh installs plus ten reseeded runs of the comparisons on one of them:
  - 73 to 75 comparisons;
  - agreement with the rubric ranking between ρ = 0.66 and 0.92;
  - the planted contrarian judge (who always picks the weaker project) sides with the panel 0–27% of the time, and in all ten reseeded runs is the **only** judge marked against the panel;
  - no position bias was flagged (the left side won 44–64%).

  The figures vary between installs because the pair picker's left/right choice and pair order follow the generated ids.

## 9. People's Choice (community vote)

This is separate from judging, but built to the same standard.
- **Ballot order:** each voter sees projects in their own random order, from a seeded shuffle. The results include a chi-square test of whether position affected picks.
- **Counting:** one pick is one vote. Quarantined ballots are excluded, and ties share a rank.
- **Sealed while open:** while voting is open, nobody sees a count: not the public, not organizers, and not through exports.
- **Publishing** fixes a fingerprint of the anonymous ballot file. Anyone can download that file and recount it, and voters can check that their ballot was counted using their receipt.
- Abuse handling is in [THREAT-MODEL.md](THREAT-MODEL.md).

Tests: `integration/voting.test.ts`, `voting-results.test.ts`, `vote-abuse.test.ts`, `unit/tally.test.ts`.

## 10. Limits

- **Reliability.** The adjustment removes *consistent* leniency. It can't fix judges who disagree about which projects are good. When reliability is low (as on the fixture), the right reading is wide rank ranges, not a precise ranking.
- **Leniency is additive.** A judge who is harsh only on one criterion, or who compresses their scale, is modelled only through their composite's shift. `low_discrimination` catches the extreme case.
- **Rank ranges assume independence.** They treat project estimates as independent; projects sharing judges are in fact correlated. They're a guide, not a confidence guarantee.
- **The comment check is a small word list.** It catches the obvious ("didn't run" with 5/5/5) and misses subtler contradictions.
- **Head to head is not part of the published ranking.** It's an organizer tool for checking the rubric results.
- **No automatic outlier removal.** This is deliberate: flags go to a person.

## Reproduce

```bash
cd apps/api
npm run judging:proof                  # regenerates docs/normalization-proof.md
npm test                               # 416 unit tests, including normalize, integrity, pairwise, assign
npm run test:integration               # results, integrity, judge console, pairwise, access matrix (needs Postgres)
```
