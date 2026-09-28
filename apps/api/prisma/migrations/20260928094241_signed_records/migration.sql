-- CreateEnum
CREATE TYPE "RecordType" AS ENUM ('judge_participation', 'participation');

-- CreateTable
CREATE TABLE "SigningKey" (
    "kid" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'Ed25519',
    "publicKeyPem" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMPTZ(3),

    CONSTRAINT "SigningKey_pkey" PRIMARY KEY ("kid")
);

-- CreateTable
CREATE TABLE "SignedRecord" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "RecordType" NOT NULL,
    "statement" JSONB NOT NULL,
    "signature" TEXT NOT NULL,
    "kid" TEXT NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" UUID,
    "revokedAt" TIMESTAMPTZ(3),
    "revokedReason" TEXT,
    "supersededById" UUID,

    CONSTRAINT "SignedRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SignedRecord_eventId_idx" ON "SignedRecord"("eventId");

-- CreateIndex
CREATE INDEX "SignedRecord_userId_idx" ON "SignedRecord"("userId");

-- AddForeignKey
ALTER TABLE "SignedRecord" ADD CONSTRAINT "SignedRecord_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignedRecord" ADD CONSTRAINT "SignedRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignedRecord" ADD CONSTRAINT "SignedRecord_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignedRecord" ADD CONSTRAINT "SignedRecord_kid_fkey" FOREIGN KEY ("kid") REFERENCES "SigningKey"("kid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignedRecord" ADD CONSTRAINT "SignedRecord_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "SignedRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One current (not superseded) record per person, event and kind.
CREATE UNIQUE INDEX "SignedRecord_current_key" ON "SignedRecord"("eventId", "userId", "type") WHERE "supersededById" IS NULL;

-- Signed records are append-only: what was signed can never change, and rows are never deleted
-- (except with their event or user). Revoking and superseding each happen once.
CREATE FUNCTION signed_record_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- cascades from deleting the event or the user are allowed; direct deletes are not
    IF pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'signed records cannot be deleted; revoke them instead';
  END IF;
  IF NEW.statement IS DISTINCT FROM OLD.statement OR NEW.signature IS DISTINCT FROM OLD.signature OR NEW.kid IS DISTINCT FROM OLD.kid
     OR NEW."issuedAt" IS DISTINCT FROM OLD."issuedAt" OR NEW."eventId" IS DISTINCT FROM OLD."eventId" OR NEW."userId" IS DISTINCT FROM OLD."userId"
     OR NEW.type IS DISTINCT FROM OLD.type THEN
    RAISE EXCEPTION 'a signed record''s statement cannot change';
  END IF;
  IF OLD."revokedAt" IS NOT NULL AND (NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt" OR NEW."revokedReason" IS DISTINCT FROM OLD."revokedReason") THEN
    RAISE EXCEPTION 'a revocation cannot be undone or edited';
  END IF;
  IF OLD."supersededById" IS NOT NULL AND NEW."supersededById" IS DISTINCT FROM OLD."supersededById" THEN
    RAISE EXCEPTION 'a superseded record stays superseded';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER signed_record_immutable BEFORE UPDATE OR DELETE ON "SignedRecord" FOR EACH ROW EXECUTE FUNCTION signed_record_immutable();

-- Superseding points the old record at the new one before the new one exists (the "one current
-- record" index allows only one of them to be current), so this key is checked at commit.
ALTER TABLE "SignedRecord" ALTER CONSTRAINT "SignedRecord_supersededById_fkey" DEFERRABLE INITIALLY DEFERRED;
