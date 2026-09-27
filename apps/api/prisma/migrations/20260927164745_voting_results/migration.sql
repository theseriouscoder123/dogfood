-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "votingBallotsHash" TEXT,
ADD COLUMN     "votingPublishedAt" TIMESTAMPTZ(3);
