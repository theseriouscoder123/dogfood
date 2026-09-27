-- CreateEnum
CREATE TYPE "CommentsMode" AS ENUM ('open', 'read_only', 'off');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('spam', 'abuse', 'off_topic', 'other');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "commentsMode" "CommentsMode" NOT NULL DEFAULT 'open';

-- CreateTable
CREATE TABLE "Comment" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "parentId" UUID,
    "body" TEXT NOT NULL,
    "ip" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),
    "hiddenAt" TIMESTAMPTZ(3),
    "hiddenById" UUID,
    "hiddenReason" TEXT,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommentReport" (
    "id" UUID NOT NULL,
    "commentId" UUID NOT NULL,
    "reporterId" UUID NOT NULL,
    "reason" "ReportReason" NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(3),

    CONSTRAINT "CommentReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Comment_projectId_createdAt_idx" ON "Comment"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "Comment_eventId_createdAt_idx" ON "Comment"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "Comment_authorId_createdAt_idx" ON "Comment"("authorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommentReport_commentId_reporterId_key" ON "CommentReport"("commentId", "reporterId");

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_hiddenById_fkey" FOREIGN KEY ("hiddenById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentReport" ADD CONSTRAINT "CommentReport_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentReport" ADD CONSTRAINT "CommentReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Hand-written invariants (Prisma can't express these) ─────────────────────
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_body_length" CHECK (char_length("body") BETWEEN 1 AND 2000);

-- Replies go one level deep, and stay on the parent's project and event.
CREATE FUNCTION comment_parent_check() RETURNS trigger AS $$
DECLARE
  p_project uuid;
  p_parent uuid;
BEGIN
  IF NEW."parentId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "projectId", "parentId" INTO p_project, p_parent FROM "Comment" WHERE id = NEW."parentId";
  IF p_project IS DISTINCT FROM NEW."projectId" THEN
    RAISE EXCEPTION 'a reply must be on the same project as its parent' USING ERRCODE = 'check_violation';
  END IF;
  IF p_parent IS NOT NULL THEN
    RAISE EXCEPTION 'replies can only go one level deep' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER comment_parent_check BEFORE INSERT OR UPDATE OF "parentId", "projectId" ON "Comment"
  FOR EACH ROW EXECUTE FUNCTION comment_parent_check();
