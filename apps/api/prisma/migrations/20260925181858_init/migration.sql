-- CreateEnum
CREATE TYPE "EventRoleType" AS ENUM ('participant', 'judge', 'organizer');

-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('captain', 'member');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('draft', 'submitted', 'withdrawn', 'disqualified');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('assigned', 'in_progress', 'submitted', 'recused');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('draft', 'submitted');

-- CreateEnum
CREATE TYPE "CoiSource" AS ENUM ('declared', 'detected');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "seeded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "registrationOpensAt" TIMESTAMPTZ(3),
    "submissionsOpenAt" TIMESTAMPTZ(3) NOT NULL,
    "submissionsCloseAt" TIMESTAMPTZ(3) NOT NULL,
    "judgingOpensAt" TIMESTAMPTZ(3),
    "judgingClosesAt" TIMESTAMPTZ(3),
    "maxTeamSize" INTEGER NOT NULL DEFAULT 4,
    "publishedRunId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventRole" (
    "eventId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "EventRoleType" NOT NULL,
    "externalId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventRole_pkey" PRIMARY KEY ("eventId","userId","role")
);

-- CreateTable
CREATE TABLE "Track" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Track_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prize" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "trackId" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "value" TEXT NOT NULL DEFAULT '',
    "rank" INTEGER,

    CONSTRAINT "Prize_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JudgeTrack" (
    "eventId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "trackId" UUID NOT NULL,

    CONSTRAINT "JudgeTrack_pkey" PRIMARY KEY ("eventId","userId","trackId")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "teamId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "role" "TeamRole" NOT NULL DEFAULT 'member',
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("teamId","userId")
);

-- CreateTable
CREATE TABLE "TeamInvite" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "maxUses" INTEGER NOT NULL DEFAULT 10,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "trackId" UUID,
    "externalId" TEXT,
    "title" TEXT NOT NULL,
    "tagline" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "repoUrl" TEXT,
    "demoUrl" TEXT,
    "videoUrl" TEXT,
    "thumbnailUrl" TEXT,
    "techTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ProjectStatus" NOT NULL DEFAULT 'draft',
    "submittedAt" TIMESTAMPTZ(3),
    "duplicateOfId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Criterion" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "weight" DECIMAL(6,3) NOT NULL DEFAULT 1,
    "minScore" INTEGER NOT NULL DEFAULT 1,
    "maxScore" INTEGER NOT NULL DEFAULT 5,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Criterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentBatch" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "seed" INTEGER,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignmentBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "batchId" UUID,
    "judgeId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'assigned',
    "recusalReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "judgeId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "status" "ReviewStatus" NOT NULL DEFAULT 'draft',
    "submittedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewScore" (
    "reviewId" UUID NOT NULL,
    "criterionId" UUID NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "ReviewScore_pkey" PRIMARY KEY ("reviewId","criterionId")
);

-- CreateTable
CREATE TABLE "ConflictOfInterest" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "judgeId" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "source" "CoiSource" NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConflictOfInterest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NormalizationRun" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "weights" JSONB NOT NULL,
    "inputHash" TEXT NOT NULL,
    "componentCount" INTEGER NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NormalizationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectResult" (
    "runId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "nReviews" INTEGER NOT NULL,
    "rawScore" DOUBLE PRECISION NOT NULL,
    "normalizedScore" DOUBLE PRECISION NOT NULL,
    "stdError" DOUBLE PRECISION,
    "rank" INTEGER NOT NULL,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "ProjectResult_pkey" PRIMARY KEY ("runId","projectId")
);

-- CreateTable
CREATE TABLE "JudgeStat" (
    "runId" UUID NOT NULL,
    "judgeId" UUID NOT NULL,
    "nReviews" INTEGER NOT NULL,
    "offset" DOUBLE PRECISION NOT NULL,
    "stdDev" DOUBLE PRECISION,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "JudgeStat_pkey" PRIMARY KEY ("runId","judgeId")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "eventId" UUID,
    "actorUserId" UUID,
    "actorLabel" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Event_slug_key" ON "Event"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Event_externalId_key" ON "Event"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Event_publishedRunId_key" ON "Event"("publishedRunId");

-- CreateIndex
CREATE INDEX "EventRole_userId_idx" ON "EventRole"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EventRole_eventId_externalId_key" ON "EventRole"("eventId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Track_eventId_name_key" ON "Track"("eventId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Track_eventId_externalId_key" ON "Track"("eventId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Track_id_eventId_key" ON "Track"("id", "eventId");

-- CreateIndex
CREATE INDEX "Prize_eventId_idx" ON "Prize"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_eventId_name_key" ON "Team"("eventId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Team_eventId_externalId_key" ON "Team"("eventId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_id_eventId_key" ON "Team"("id", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_eventId_userId_key" ON "TeamMember"("eventId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamInvite_tokenHash_key" ON "TeamInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "Project_eventId_status_idx" ON "Project"("eventId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Project_eventId_externalId_key" ON "Project"("eventId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_id_eventId_key" ON "Project"("id", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Criterion_eventId_key_key" ON "Criterion"("eventId", "key");

-- CreateIndex
CREATE INDEX "Assignment_eventId_status_idx" ON "Assignment"("eventId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_judgeId_projectId_key" ON "Assignment"("judgeId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Assignment_id_judgeId_projectId_key" ON "Assignment"("id", "judgeId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Review_assignmentId_key" ON "Review"("assignmentId");

-- CreateIndex
CREATE INDEX "Review_eventId_judgeId_idx" ON "Review"("eventId", "judgeId");

-- CreateIndex
CREATE INDEX "Review_projectId_idx" ON "Review"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Review_assignmentId_judgeId_projectId_key" ON "Review"("assignmentId", "judgeId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ConflictOfInterest_eventId_judgeId_teamId_key" ON "ConflictOfInterest"("eventId", "judgeId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_hash_key" ON "AuditLog"("hash");

-- CreateIndex
CREATE INDEX "AuditLog_eventId_createdAt_idx" ON "AuditLog"("eventId", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_publishedRunId_fkey" FOREIGN KEY ("publishedRunId") REFERENCES "NormalizationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRole" ADD CONSTRAINT "EventRole_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventRole" ADD CONSTRAINT "EventRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Track" ADD CONSTRAINT "Track_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prize" ADD CONSTRAINT "Prize_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prize" ADD CONSTRAINT "Prize_trackId_eventId_fkey" FOREIGN KEY ("trackId", "eventId") REFERENCES "Track"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JudgeTrack" ADD CONSTRAINT "JudgeTrack_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JudgeTrack" ADD CONSTRAINT "JudgeTrack_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JudgeTrack" ADD CONSTRAINT "JudgeTrack_trackId_eventId_fkey" FOREIGN KEY ("trackId", "eventId") REFERENCES "Track"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_eventId_fkey" FOREIGN KEY ("teamId", "eventId") REFERENCES "Team"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_teamId_eventId_fkey" FOREIGN KEY ("teamId", "eventId") REFERENCES "Team"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_trackId_eventId_fkey" FOREIGN KEY ("trackId", "eventId") REFERENCES "Track"("id", "eventId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Criterion" ADD CONSTRAINT "Criterion_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentBatch" ADD CONSTRAINT "AssignmentBatch_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentBatch" ADD CONSTRAINT "AssignmentBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "AssignmentBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_judgeId_fkey" FOREIGN KEY ("judgeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_projectId_eventId_fkey" FOREIGN KEY ("projectId", "eventId") REFERENCES "Project"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_assignmentId_judgeId_projectId_fkey" FOREIGN KEY ("assignmentId", "judgeId", "projectId") REFERENCES "Assignment"("id", "judgeId", "projectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewScore" ADD CONSTRAINT "ReviewScore_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewScore" ADD CONSTRAINT "ReviewScore_criterionId_fkey" FOREIGN KEY ("criterionId") REFERENCES "Criterion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflictOfInterest" ADD CONSTRAINT "ConflictOfInterest_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflictOfInterest" ADD CONSTRAINT "ConflictOfInterest_judgeId_fkey" FOREIGN KEY ("judgeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConflictOfInterest" ADD CONSTRAINT "ConflictOfInterest_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NormalizationRun" ADD CONSTRAINT "NormalizationRun_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NormalizationRun" ADD CONSTRAINT "NormalizationRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectResult" ADD CONSTRAINT "ProjectResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "NormalizationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectResult" ADD CONSTRAINT "ProjectResult_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JudgeStat" ADD CONSTRAINT "JudgeStat_runId_fkey" FOREIGN KEY ("runId") REFERENCES "NormalizationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ════════════════════════════════════════════════════════════════════════════
-- Hand-written invariants (Prisma cannot express these). Keep this block when
-- regenerating; every rule here is also documented in DATA-MODEL.md.
-- ════════════════════════════════════════════════════════════════════════════

-- A team has at most one live project per event. Flagged duplicates and
-- withdrawn entries don't count, so history is kept without breaking the rule.
CREATE UNIQUE INDEX "Project_one_live_per_team"
  ON "Project" ("eventId", "teamId")
  WHERE "duplicateOfId" IS NULL AND "status" <> 'withdrawn';

ALTER TABLE "Project"   ADD CONSTRAINT "Project_not_own_duplicate"  CHECK ("duplicateOfId" IS NULL OR "duplicateOfId" <> "id");
ALTER TABLE "Event"     ADD CONSTRAINT "Event_submission_window"    CHECK ("submissionsOpenAt" < "submissionsCloseAt");
ALTER TABLE "Event"     ADD CONSTRAINT "Event_judging_window"       CHECK ("judgingOpensAt" IS NULL OR "judgingClosesAt" IS NULL OR "judgingOpensAt" < "judgingClosesAt");
ALTER TABLE "Event"     ADD CONSTRAINT "Event_max_team_size"        CHECK ("maxTeamSize" BETWEEN 1 AND 50);
ALTER TABLE "Criterion" ADD CONSTRAINT "Criterion_weight_positive"  CHECK ("weight" > 0);
ALTER TABLE "Criterion" ADD CONSTRAINT "Criterion_range"            CHECK ("minScore" < "maxScore");
ALTER TABLE "TeamInvite" ADD CONSTRAINT "TeamInvite_uses"           CHECK ("uses" >= 0 AND "uses" <= "maxUses");
ALTER TABLE "User"      ADD CONSTRAINT "User_email_lowercase"       CHECK ("email" = lower("email"));

-- Gallery search: case-insensitive title/tagline lookups.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Project_search_trgm" ON "Project" USING gin ((lower("title" || ' ' || "tagline")) gin_trgm_ops);

-- A score must be inside its criterion's range, and the criterion must belong
-- to the same event as the review. Enforced here so no code path can skip it.
CREATE FUNCTION review_score_check() RETURNS trigger AS $$
DECLARE
  c        RECORD;
  r_event  uuid;
BEGIN
  SELECT "eventId", "minScore", "maxScore" INTO c FROM "Criterion" WHERE "id" = NEW."criterionId";
  SELECT "eventId" INTO r_event FROM "Review" WHERE "id" = NEW."reviewId";
  IF c."eventId" IS DISTINCT FROM r_event THEN
    RAISE EXCEPTION 'criterion % does not belong to the event of review %', NEW."criterionId", NEW."reviewId"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."value" < c."minScore" OR NEW."value" > c."maxScore" THEN
    RAISE EXCEPTION 'score % is outside the allowed range [%, %]', NEW."value", c."minScore", c."maxScore"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER review_score_check
  BEFORE INSERT OR UPDATE ON "ReviewScore"
  FOR EACH ROW EXECUTE FUNCTION review_score_check();

-- The audit log is append-only. Tamper-evidence comes from the hash chain;
-- this trigger makes accidental or casual rewrites impossible.
CREATE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only (% blocked)', TG_OP USING ERRCODE = 'insufficient_privilege';
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();
