-- CreateTable
CREATE TABLE "ApiToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "expiresAt" TIMESTAMPTZ(3),
    "lastUsedAt" TIMESTAMPTZ(3),
    "lastUsedIp" TEXT,
    "revokedAt" TIMESTAMPTZ(3),
    "seeded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ApiToken_userId_idx" ON "ApiToken"("userId");

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Scopes are a non-empty subset of {read, write}; names are short and not blank.
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_scopes_check" CHECK (cardinality("scopes") > 0 AND "scopes" <@ ARRAY['read', 'write']::TEXT[]);
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 60);
