-- DropIndex
DROP INDEX "Team_eventId_name_key";

-- CreateIndex
CREATE INDEX "Team_eventId_name_idx" ON "Team"("eventId", "name");
