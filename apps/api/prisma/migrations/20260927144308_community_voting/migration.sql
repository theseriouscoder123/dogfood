-- CreateEnum
CREATE TYPE "VotingMode" AS ENUM ('email', 'invite', 'accounts');

-- CreateEnum
CREATE TYPE "BallotStatus" AS ENUM ('counted', 'quarantined');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "voterDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "votesPerVoter" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "votingClosesAt" TIMESTAMPTZ(3),
ADD COLUMN     "votingMode" "VotingMode" NOT NULL DEFAULT 'email',
ADD COLUMN     "votingOpensAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerifiedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "LoginLink" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "next" TEXT NOT NULL DEFAULT '/',
    "ip" TEXT,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoteInvite" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "VoteInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Voter" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "kind" "VotingMode" NOT NULL,
    "userId" UUID,
    "inviteId" UUID,
    "identityKey" TEXT NOT NULL,
    "emailKey" TEXT,
    "tokenHash" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Voter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ballot" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "voterId" UUID NOT NULL,
    "receipt" TEXT NOT NULL,
    "status" "BallotStatus" NOT NULL DEFAULT 'counted',
    "quarantineReason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Ballot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BallotChoice" (
    "ballotId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BallotChoice_pkey" PRIMARY KEY ("ballotId","projectId")
);

-- CreateIndex
CREATE UNIQUE INDEX "LoginLink_tokenHash_key" ON "LoginLink"("tokenHash");

-- CreateIndex
CREATE INDEX "LoginLink_email_createdAt_idx" ON "LoginLink"("email", "createdAt");

-- CreateIndex
CREATE INDEX "LoginLink_ip_createdAt_idx" ON "LoginLink"("ip", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VoteInvite_codeHash_key" ON "VoteInvite"("codeHash");

-- CreateIndex
CREATE INDEX "VoteInvite_eventId_idx" ON "VoteInvite"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Voter_inviteId_key" ON "Voter"("inviteId");

-- CreateIndex
CREATE UNIQUE INDEX "Voter_tokenHash_key" ON "Voter"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Voter_eventId_identityKey_key" ON "Voter"("eventId", "identityKey");

-- CreateIndex
CREATE UNIQUE INDEX "Voter_eventId_emailKey_key" ON "Voter"("eventId", "emailKey");

-- CreateIndex
CREATE UNIQUE INDEX "Ballot_voterId_key" ON "Ballot"("voterId");

-- CreateIndex
CREATE UNIQUE INDEX "Ballot_receipt_key" ON "Ballot"("receipt");

-- CreateIndex
CREATE INDEX "Ballot_eventId_status_idx" ON "Ballot"("eventId", "status");

-- CreateIndex
CREATE INDEX "BallotChoice_projectId_idx" ON "BallotChoice"("projectId");

-- AddForeignKey
ALTER TABLE "VoteInvite" ADD CONSTRAINT "VoteInvite_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteInvite" ADD CONSTRAINT "VoteInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voter" ADD CONSTRAINT "Voter_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voter" ADD CONSTRAINT "Voter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voter" ADD CONSTRAINT "Voter_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "VoteInvite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ballot" ADD CONSTRAINT "Ballot_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ballot" ADD CONSTRAINT "Ballot_voterId_fkey" FOREIGN KEY ("voterId") REFERENCES "Voter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BallotChoice" ADD CONSTRAINT "BallotChoice_ballotId_fkey" FOREIGN KEY ("ballotId") REFERENCES "Ballot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BallotChoice" ADD CONSTRAINT "BallotChoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Hand-written invariants (Prisma can't express these) ─────────────────────
ALTER TABLE "Event" ADD CONSTRAINT "Event_voting_window"
  CHECK ("votingOpensAt" IS NULL OR "votingClosesAt" IS NULL OR "votingOpensAt" < "votingClosesAt");
ALTER TABLE "Event" ADD CONSTRAINT "Event_votes_per_voter" CHECK ("votesPerVoter" BETWEEN 1 AND 20);
ALTER TABLE "BallotChoice" ADD CONSTRAINT "BallotChoice_position" CHECK ("position" >= 0);
-- Each kind of voter carries exactly the identity that kind needs.
ALTER TABLE "Voter" ADD CONSTRAINT "Voter_identity" CHECK (
  ("kind" = 'invite' AND "inviteId" IS NOT NULL AND "tokenHash" IS NOT NULL AND "userId" IS NULL) OR
  ("kind" <> 'invite' AND "userId" IS NOT NULL AND "inviteId" IS NULL)
);

-- A ballot choice must be a submitted, non-duplicate project of the ballot's own event, and a
-- ballot can never hold more choices than the event allows. The API checks all of this first;
-- the trigger means no code path (a bug, a script, a hand-written query) can get around it.
CREATE FUNCTION ballot_choice_check() RETURNS trigger AS $$
DECLARE
  b_event uuid;
  p_event uuid;
  p_status text;
  p_dup uuid;
  cap int;
  n int;
BEGIN
  SELECT "eventId" INTO b_event FROM "Ballot" WHERE id = NEW."ballotId";
  SELECT "eventId", status::text, "duplicateOfId" INTO p_event, p_status, p_dup FROM "Project" WHERE id = NEW."projectId";
  IF p_event IS DISTINCT FROM b_event THEN
    RAISE EXCEPTION 'ballot choice must be a project of the same event' USING ERRCODE = 'check_violation';
  END IF;
  IF p_status <> 'submitted' OR p_dup IS NOT NULL THEN
    RAISE EXCEPTION 'only submitted, non-duplicate projects can be voted for' USING ERRCODE = 'check_violation';
  END IF;
  SELECT "votesPerVoter" INTO cap FROM "Event" WHERE id = b_event;
  SELECT count(*) INTO n FROM "BallotChoice" WHERE "ballotId" = NEW."ballotId" AND "projectId" <> NEW."projectId";
  IF n + 1 > cap THEN
    RAISE EXCEPTION 'ballot holds more than % choices', cap USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER ballot_choice_check BEFORE INSERT OR UPDATE ON "BallotChoice"
  FOR EACH ROW EXECUTE FUNCTION ballot_choice_check();
