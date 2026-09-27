-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('short_text', 'long_text', 'url', 'single_select', 'checkbox');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "bannerUrl" TEXT,
ADD COLUMN     "location" TEXT NOT NULL DEFAULT 'Online',
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "overview" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "rules" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "tagline" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "SubmissionQuestion" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "help" TEXT NOT NULL DEFAULT '',
    "type" "QuestionType" NOT NULL,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "required" BOOLEAN NOT NULL DEFAULT false,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectAnswer" (
    "projectId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProjectAnswer_pkey" PRIMARY KEY ("projectId","questionId")
);

-- CreateTable
CREATE TABLE "Upload" (
    "id" UUID NOT NULL,
    "sha256" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordReset" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubmissionQuestion_eventId_position_idx" ON "SubmissionQuestion"("eventId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Upload_sha256_key" ON "Upload"("sha256");

-- CreateIndex
CREATE INDEX "Upload_uploadedById_createdAt_idx" ON "Upload"("uploadedById", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordReset_tokenHash_key" ON "PasswordReset"("tokenHash");

-- AddForeignKey
ALTER TABLE "SubmissionQuestion" ADD CONSTRAINT "SubmissionQuestion_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAnswer" ADD CONSTRAINT "ProjectAnswer_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectAnswer" ADD CONSTRAINT "ProjectAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "SubmissionQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
