-- AlterTable
ALTER TABLE "SubmissionQuestion" ADD COLUMN     "externalId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionQuestion_eventId_externalId_key" ON "SubmissionQuestion"("eventId", "externalId");

