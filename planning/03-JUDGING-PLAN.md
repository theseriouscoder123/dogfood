# JUDGING.md plan: assignment, scoring, normalization

The numbers below come from a pre-kickoff research prototype run on the official `fixtures.json`, in the scratchpad and not in the repo. The real implementation, written after kickoff, must regenerate them. Script name: `npm run judging:proof`.

## 1. Pipeline
```
review (raw per-criterion ints)
  → weighted composite per review:  c = Σ w_k·x_k / Σ w_k       (weights read at compute time)
  → normalization run (judge-effect model below)
  → ProjectResult snapshot (normalized score, std error, rank, flags)
  → organizer publishes one run  →  results visible
```
Criteria with different ranges are first rescaled to [0,1], then mapped back onto 1–5 for display.

## 2. Normalization method: additive judge-effect model with shrinkage

**Model.** For judge *j* reviewing project *p*:

    x_jp = μ + a_p + b_j + ε_jp

- μ is the global mean.
- a_p is the project's quality, which is what we rank on.
- b_j is judge *j*'s leniency offset: positive for a generous judge, negative for a harsh one.
- ε_jp is noise.

**Estimation.** Minimize

    Σ (x_jp − μ − a_p − b_j)²  +  λ_j Σ b_j²  +  λ_p Σ a_p²

This is ridge regression. Equivalently, it is the best linear unbiased prediction (BLUP) of a random-effects model where λ = σ²_ε / σ²_effect. Solve it by alternating closed-form updates (backfitting), which is about 20 lines of TypeScript with no numerical library:

    b_j ← Σ_p (x_jp − μ − a_p) / (n_j + λ_j)
    a_p ← Σ_j (x_jp − μ − b_j) / (n_p + λ_p)
    re-center b to mean 0; repeat until max change < 1e-9

The result is deterministic, with no random initialization, and converges in well under 100 iterations.

**Reported score** = μ + a_p, on the original 1–5 scale, so organizers can read it directly.

**Standard error** ≈ σ̂_ε / √(n_p + λ_p). It's shown on the results page, and projects with overlapping intervals are marked "statistically tied".

**Parameters:** λ_j = 1, λ_p = 0.5. They are chosen by simulation, and the results are flat across λ_j ∈ [0.5, 2] (see §4).

### Why this method, with the evidence

| Method | Mean Spearman ρ vs true ranking (300 simulations on the fixture's real assignment graph) |
|---|---|
| Raw mean | 0.854 |
| Per-judge z-score (with a floor and minimum-n guards) | **0.840: worse than doing nothing** |
| **Additive + shrinkage** | **0.887** |
| Additive, in a world where judges have **no** bias | 0.906 vs raw 0.912. The insurance costs almost nothing. |

- **Z-score is the textbook answer, and it's wrong here.** The median judge in the fixtures has about 3–4 reviews. A standard deviation estimated from three numbers is mostly noise, and dividing by it amplifies that noise. It also divides by zero for:
  - the flat judge (jdg_07: 4/4/4)
  - the two single-review judges (jdg_01, jdg_23)

  It also assumes every judge sees a random sample of projects. They don't: judges are tied to tracks.
- **The joint model separates judge bias from project quality.** A judge who happened to get a weak batch isn't mislabeled as harsh, because those same projects were also scored by other judges.
- **Shrinkage handles small samples gracefully.** A judge with 1 review can only move their offset by a fraction of their deviation: n/(n+λ).
- **Not attempted: per-judge scale** (a multiplicative "range" term). With about 4 reviews per judge it can't be estimated reliably. JUDGING.md names it as the next step once events have more reviews per judge.

### Identifiability
Judge offsets are only comparable within a *connected* judge–project graph. The fixture graph is **one connected component**, because 9 judges span two tracks each. Every normalization run:
- checks connectivity
- stores the component count
- warns the organizer if it's greater than 1, since cross-component comparisons are then not meaningful

The assignment algorithm (§5) deliberately creates overlap.

### Fixture results (prototype; composite = equal weights; prj_41 excluded as a duplicate; run with λ_j = 2, so regenerate these at the final λ)
- Rank agreement: raw vs model ρ = 0.966, raw vs z-score ρ = 0.889. The model makes small corrections, while z-score reshuffles.
- Most generous judges: jdg_02 (+0.43, n=6), jdg_15 (+0.38, n=6). Harshest: jdg_10 (−0.34, n=3), jdg_20 (−0.24, n=6).
- Biggest rank moves, raw → model:
  - prj_35: #22 → #29
  - prj_39: #21 → #28
  - prj_02: #15 → #21
  - prj_07: #30 → #25
  - prj_12: #24 → #19
  - prj_14: #28 → #23
- Top of the table: prj_34 overtakes prj_11 for #1. prj_10 drops from #3 to #6: it has only 2 reviews, and one came from the generous jdg_15.

## 3. Edge-case policies (each named in the fixtures, each answered in JUDGING.md)

| Case | Fixture | Policy |
|---|---|---|
| Judge gives everything the same score | jdg_07: 4/4/4 on prj_09, 17 and 19 | Flag as `low_discrimination` (σ < 0.25 with n ≥ 3) on the dashboard. **Included** by default: the model absorbs their leniency (+0.27) and they add little ranking signal, which is the correct behavior. The organizer can exclude a judge with a required reason. That action is audit-logged, and the dashboard previews the rank impact before confirming. |
| Judges with a single review | jdg_01 (2/2/2), jdg_23 | Their offset is shrunk by 1/(1+λ_j). Flagged as `low_sample`. |
| Unfinished batches | 8 projects with only 2 reviews (prj_10, 15, 18, 19, 24, 29, 39, 40) | Still ranked, but flagged `provisional` with a wider standard error. The dashboard lists them as "needs reassignment". Organizers can set a minimum review count for prize eligibility (default 3). |
| Duplicate submission | prj_41 = prj_07 (same team, same repo; prj_41 filed 3 minutes before close) | Detected on import or submit using the same team plus a normalized repo URL or title. The later entry gets `duplicateOfId` and is excluded from ranking. Its reviews are kept but don't count. **Why not merge:** jdg_19, jdg_21 and jdg_26 scored *both* entries and disagree with themselves (jdg_19: 2.33 vs 3.67). Merging would double-count judges, and there's no timestamp to pick one. The organizer can override this in the UI, and the override is audited. |
| Late submission / deadline gaming | Checker probe; prj_41 at 17:57 | Server clock, UTC, enforced on create, edit **and** status change. Refused attempts are audit-logged, so the organizer can see who tried after the deadline. |
| Conflict of interest | None in the fixtures (no judge email is on a team) | Detected automatically when a judge's email appears in a team's member list, plus self-declared COIs. The assignment algorithm never assigns across a COI. |

## 4. Normalization Proof (tie-breaker bonus + Best Judging Engine)
`npm run judging:proof` writes `docs/normalization-proof.md`, containing:
1. **Raw vs normalized table** for all 40 ranked projects, with rank changes.
2. **Judge offset table** with n, offset and flags.
3. **Simulation study:** generate true quality and judge bias on the *real* fixture assignment graph, add noise, and compare how well raw, z-score and additive recover the truth. Report mean and 10th-percentile Spearman ρ, plus the λ sensitivity sweep:

   | λ_j | ρ |
   |---|---|
   | 0.5 | 0.888 |
   | 1 | 0.889 |
   | 2 | 0.886 |
   | 4 | 0.879 |
   | 8 | 0.870 |

4. **The no-bias control:** what the method costs when judges are fair.
5. **Seeded and reproducible:** the proof states its RNG seed, so anyone can rerun it and get the same numbers.

## 5. Assignment strategy (T2 algorithmic assignment)
**Hard constraints:**
- the judge covers the project's track
- no conflict of interest
- no repeat (judge, project) pair
- each project gets k reviews (default 3)

**Algorithm** (greedy, seeded, reproducible; the params and seed are stored in `AssignmentBatch`):
1. Order projects by the fewest eligible judges first, so scarce tracks are served first.
2. For each project, pick k judges by lowest current load. Break ties by preferring judges who share **no** other project with the judges already chosen for this one. This spreads overlap and keeps the graph connected and well mixed. Break any remaining ties with the seeded RNG.
3. Check capacity before running: for each track, projects × k ÷ judges. The fixture's worst case is trk_01 and trk_08: 6 projects × 3 reviews ÷ 3 judges = 6 reviews each. Warn if the maximum load goes over the organizer's cap.
4. Report load min/max/σ and the connected-component count.

**Contrast with the fixture's actual assignments,** which had loads from 1 to 11: that's the problem the algorithm fixes. Manual and batch assignment (CSV upload) use the same constraint checks.

## 6. Integrity features to mention in JUDGING.md
- **Isolation is enforced in the backend** by the policy layer, and every judge query is scoped. There's one automated test per matrix cell, and `run.py` runs in CI.
- **Results stay hidden** until the organizer publishes a run. Judges never see aggregates.
- **Hash-chained audit log.** Every score write, weight change, exclusion, duplicate resolution and publish is recorded. Organizers read it on an audit page with filters, with no database client needed.
- **Signed judge participation records** (T4): Ed25519, verifiable publicly at `/verify/:id` against the published key.
