-- CreateEnum
CREATE TYPE "PairwiseOutcome" AS ENUM ('left', 'right', 'tie');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "pairwiseEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PairwiseComparison" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "judgeId" UUID NOT NULL,
    "leftProjectId" UUID NOT NULL,
    "rightProjectId" UUID NOT NULL,
    "pairKey" TEXT NOT NULL,
    "outcome" "PairwiseOutcome" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PairwiseComparison_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PairwiseComparison_eventId_idx" ON "PairwiseComparison"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "PairwiseComparison_judgeId_pairKey_key" ON "PairwiseComparison"("judgeId", "pairKey");

-- AddForeignKey
ALTER TABLE "PairwiseComparison" ADD CONSTRAINT "PairwiseComparison_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PairwiseComparison" ADD CONSTRAINT "PairwiseComparison_judgeId_fkey" FOREIGN KEY ("judgeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PairwiseComparison" ADD CONSTRAINT "PairwiseComparison_judgeId_leftProjectId_fkey" FOREIGN KEY ("judgeId", "leftProjectId") REFERENCES "Assignment"("judgeId", "projectId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PairwiseComparison" ADD CONSTRAINT "PairwiseComparison_judgeId_rightProjectId_fkey" FOREIGN KEY ("judgeId", "rightProjectId") REFERENCES "Assignment"("judgeId", "projectId") ON DELETE CASCADE ON UPDATE CASCADE;


-- A comparison is between two different projects, and pairKey is exactly the sorted pair.
ALTER TABLE "PairwiseComparison" ADD CONSTRAINT "PairwiseComparison_distinct" CHECK ("leftProjectId" <> "rightProjectId");
ALTER TABLE "PairwiseComparison" ADD CONSTRAINT "PairwiseComparison_pairKey" CHECK (
  "pairKey" = LEAST("leftProjectId"::text, "rightProjectId"::text) || ':' || GREATEST("leftProjectId"::text, "rightProjectId"::text)
);
