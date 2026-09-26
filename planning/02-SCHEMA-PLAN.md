# Schema plan (PostgreSQL + Prisma)

A design sketch to type into `schema.prisma` after kickoff. It becomes DATA-MODEL.md.

## Design principles (these go in DATA-MODEL.md)
1. **Roles are scoped to an event.** One person can judge event A and compete in event B. Admin is the only global role, and "visitor" means not logged in.
2. **Scores store raw values per criterion. Weights are applied when results are computed.** The organizer can re-weight the rubric after judging without anyone re-scoring. Every weight change is audit-logged.
3. **Results are immutable snapshots.** Each normalization run records its inputs (method, parameters, input hash) and its outputs. "Publish" points the event at one run. You can always answer "why did the ranking change?"
4. **The database enforces the invariants.** Foreign keys, `CHECK` constraints and partial unique indexes back up the app code rather than relying on it.
5. **Every fixture record keeps its original ID** (`externalId`, unique within its event). Import is idempotent, export round-trips, and the checker routes use readable IDs like `jdg_24`.
6. **The audit log is append-only and hash-chained.** The database role cannot UPDATE or DELETE it, and each row stores `hash = sha256(prevHash ‖ row)`.

## Entities

```prisma
// ── identity ───────────────────────────────────────────────
model User {
  id           String   @id @default(uuid())
  email        String   @unique            // lower-cased on write
  name         String
  passwordHash String?                     // null = magic-link-only (e.g. imported judges)
  isAdmin      Boolean  @default(false)    // the only global role
  createdAt    DateTime @default(now())
}
model Session {                            // server-side sessions; cookie holds the raw token
  id         String   @id @default(uuid())
  tokenHash  String   @unique              // sha256(token)
  userId     String
  expiresAt  DateTime
  seeded     Boolean  @default(false)      // demo sessions; disabled by SEED_DEMO_SESSIONS=false
}
model ApiToken { id, userId, name, tokenHash @unique, scopes String[], lastUsedAt, revokedAt }   // T4

// ── event setup ────────────────────────────────────────────
model Event {
  id, slug @unique, name, description, timezone
  registrationOpensAt, submissionsOpenAt, submissionsCloseAt,       // UTC; CHECK open < close
  judgingOpensAt, judgingClosesAt
  maxTeamSize Int @default(4)
  publishedRunId String?                   // → NormalizationRun; null = results hidden
}
model EventRole {                          // participant | judge | organizer
  eventId, userId, role Role
  @@id([eventId, userId, role])
}
model Track  { id, eventId, externalId?, name, description; @@unique([eventId, externalId]) }
model Prize  { id, eventId, trackId?, name, description, rank Int? }
model JudgeTrack { eventId, userId, trackId; @@id([eventId, userId, trackId]) }  // what a judge may see

// ── teams & submissions ────────────────────────────────────
model Team { id, eventId, externalId?, name, createdById; @@unique([eventId, name]) }
model TeamMember {
  teamId, userId, eventId, role (captain|member)
  @@id([teamId, userId])
  @@unique([eventId, userId])              // ONE team per person per event
}
model TeamInvite { id, teamId, tokenHash @unique, createdById, expiresAt, maxUses, uses, revokedAt }
model Project {
  id, eventId, teamId, trackId, externalId?
  title, tagline, description, repoUrl, demoUrl, videoUrl, thumbnailPath, techTags String[]
  status        ProjectStatus  // draft | submitted | withdrawn | disqualified
  submittedAt   DateTime?
  duplicateOfId String?        // set by duplicate detection; excluded from ranking
  searchVector  Unsupported("tsvector")?   // generated column + GIN index for gallery search
  createdAt, updatedAt
}
// raw SQL migration:
//   CREATE UNIQUE INDEX one_live_project_per_team ON "Project"("eventId","teamId")
//     WHERE "duplicateOfId" IS NULL AND status <> 'withdrawn';
//   plus a trigger or a composite FK so that project.trackId belongs to project.eventId

// ── judging ────────────────────────────────────────────────
model Criterion {
  id, eventId, key, label, description
  weight Decimal   // > 0; normalized at compute time, need not sum to 1
  minScore Int @default(1), maxScore Int @default(5), position Int
  @@unique([eventId, key])
}   // keys, ranges and adding/removing criteria lock once the first score exists; weights stay editable
model AssignmentBatch { id, eventId, name, algorithm, params Json, seed Int, createdById, createdAt }
model Assignment {
  id, eventId, batchId, judgeId, projectId
  status (assigned|in_progress|submitted|recused)
  recusalReason String?
  @@unique([judgeId, projectId])
}
model Review {                              // one per assignment
  id, assignmentId @unique, judgeId, projectId, comment, status (draft|submitted), submittedAt
}
model ReviewScore {
  reviewId, criterionId, value Int
  @@id([reviewId, criterionId])
}   // CHECK value between the criterion's min and max (enforced by trigger, or by validating
    // in a transaction that loads the criterion; a trigger is the version worth defending)
model ConflictOfInterest { eventId, judgeId, teamId, source (declared|detected), note }

// ── results ────────────────────────────────────────────────
model NormalizationRun {
  id, eventId, method, params Json, inputHash, weightsSnapshot Json, createdById, createdAt
}
model ProjectResult {
  runId, projectId, nReviews, rawScore, normalizedScore, stdError, rank, flags String[]
  @@id([runId, projectId])
}
model JudgeStat { runId, judgeId, nReviews, offset, stdDev, flags String[]; @@id([runId, judgeId]) }

// ── T4 ─────────────────────────────────────────────────────
model Webhook         { id, eventId, url, secret, eventTypes String[], active }
model WebhookDelivery { id, webhookId, eventType, payload Json, status, attempts, nextAttemptAt, lastResponseCode }  // outbox
model SigningKey      { id (kid), publicKeyPem, createdAt, retiredAt }   // private key lives in a mounted volume, not in the DB
model Credential {                         // certificates + signed judge participation records
  id, eventId, userId, kind (participant|judge|winner)
  payload Json, signature String, keyId, issuedAt, revokedAt
}   // public: GET /verify/:id → re-verifies the Ed25519 signature against the published key

// ── audit ──────────────────────────────────────────────────
model AuditLog {
  id BigInt @id @default(autoincrement())
  eventId?, actorUserId?, actorRole, action, entityType, entityId
  before Json?, after Json?, ip, requestId, createdAt, prevHash, hash
}
```

## Permission matrix (backend policy layer; one test per cell)

| Actor | Own scores | Peer scores | Other track | Aggregates / results before publish | Audit log |
|---|---|---|---|---|---|
| visitor | ✗ | ✗ | ✗ | ✗ | ✗ |
| participant | ✗ | ✗ | ✗ | ✗ | ✗ |
| judge | ✓ | ✗ **403** | ✗ **403** | ✗ | ✗ |
| organizer | ✓ | ✓ | ✓ | ✓ | ✓ |
| admin | ✓ | ✓ | ✓ | ✓ | ✓ |

**Put it in one place:** `can(actor, action, resource)` in `api/src/policy.ts`, and call it from every route. Also scope every judge query by `judgeId = actor.id` at the query level, so a forgotten check still can't leak data.

## Fixture import mapping (`fixtures.json` → schema)

| Fixture | Becomes | Notes |
|---|---|---|
| `event` | `Event` slug `sample-hack-2026` | `submissionsCloseAt = 2026-03-01T18:00Z`, so the event is already closed and the checker's T1 #3 passes honestly |
| `tracks[8]` | `Track` | `externalId = trk_xx` |
| `judges[30]` | `User` + `EventRole(judge)` + `JudgeTrack` | 9 judges cover 2 tracks each |
| `teams[40]` | `Team` + `User` per member email + `TeamMember` + `EventRole(participant)` | First member becomes captain. 13 teams are solo. |
| `projects[41]` | `Project` (status `submitted`) | **prj_41 duplicates prj_07**: same team tm_07, same repo, submitted 17:57 (3 minutes before close). Importer sets `duplicateOfId`. |
| `scores[126]` | `Assignment` (in a batch named "Imported"), `Review`, and one `ReviewScore` per criterion | The criteria in the data are functionality, quality and innovation. The importer creates them with equal weights and a **1–5** range, even though the data only uses 2–5. |
| (not in the fixture) | organizer and admin users | Seeded, and credentials are printed at boot |

Import runs in a single transaction and upserts on `(eventId, externalId)`, so running it again is a no-op. **Bulk export** (T4) writes the same JSON shape back out, plus CSVs for each stage. The claim "you can leave as easily as you arrived" then holds by construction, and a round-trip test proves it.

## CSV exports ("at every stage")
Each is available to organizers only:
- `participants.csv`
- `teams.csv`
- `projects.csv`
- `assignments.csv` (includes progress status)
- `reviews.csv` (one row per criterion)
- `results.csv` (raw, normalized, rank, number of reviews, flags)

**Quote fields correctly.** Comments contain commas, and fields starting with `=`, `+`, `-` or `@` need a prefix to prevent CSV formula injection. That last one is a nice touch for the threat model.
