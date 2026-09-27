-- CreateTable
CREATE TABLE "IntegrityResolution" (
    "eventId" UUID NOT NULL,
    "flagKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "resolvedById" UUID,
    "resolvedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrityResolution_pkey" PRIMARY KEY ("eventId","flagKey")
);

-- AddForeignKey
ALTER TABLE "IntegrityResolution" ADD CONSTRAINT "IntegrityResolution_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrityResolution" ADD CONSTRAINT "IntegrityResolution_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
