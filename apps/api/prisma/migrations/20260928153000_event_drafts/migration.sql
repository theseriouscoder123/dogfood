-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "createdById" UUID,
ADD COLUMN     "publishedAt" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Events that existed before drafts were introduced were all public.
UPDATE "Event" SET "publishedAt" = "createdAt" WHERE "publishedAt" IS NULL;
