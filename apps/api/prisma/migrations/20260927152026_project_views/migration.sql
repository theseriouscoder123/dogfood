-- CreateTable
CREATE TABLE "ProjectView" (
    "eventId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "viewerKey" TEXT NOT NULL,
    "firstViewedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectView_pkey" PRIMARY KEY ("projectId","viewerKey")
);

-- CreateIndex
CREATE INDEX "ProjectView_eventId_viewerKey_idx" ON "ProjectView"("eventId", "viewerKey");

-- AddForeignKey
ALTER TABLE "ProjectView" ADD CONSTRAINT "ProjectView_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
