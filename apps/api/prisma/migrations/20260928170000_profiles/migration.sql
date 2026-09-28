-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "bio" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "githubUrl" TEXT,
ADD COLUMN     "handle" TEXT,
ADD COLUMN     "headline" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "linkedinUrl" TEXT,
ADD COLUMN     "location" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "website" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_handle_key" ON "User"("handle");


ALTER TABLE "User" ADD CONSTRAINT "User_handle_format" CHECK ("handle" IS NULL OR "handle" ~ '^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$');

-- Everyone who already exists gets a handle from their name, with a short suffix only where needed.
WITH base AS (
  SELECT id, left(trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')), 24) AS b FROM "User"
), ranked AS (
  SELECT id, CASE WHEN length(b) < 3 THEN 'user' ELSE b END AS b, row_number() OVER (PARTITION BY CASE WHEN length(b) < 3 THEN 'user' ELSE b END ORDER BY id) AS n FROM base
)
UPDATE "User" u SET "handle" = CASE WHEN r.n = 1 AND r.b <> 'user' THEN r.b ELSE r.b || '-' || substr(replace(u.id::text, '-', ''), 1, 5) END
FROM ranked r WHERE r.id = u.id;
