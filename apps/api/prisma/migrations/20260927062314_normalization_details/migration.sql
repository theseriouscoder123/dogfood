-- AlterTable
ALTER TABLE "JudgeStat" ADD COLUMN     "rawMean" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "NormalizationRun" ADD COLUMN     "summary" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "ProjectResult" ADD COLUMN     "pTop" DOUBLE PRECISION,
ADD COLUMN     "rankHigh" INTEGER,
ADD COLUMN     "rankLow" INTEGER,
ADD COLUMN     "rawRank" INTEGER,
ALTER COLUMN "rawScore" DROP NOT NULL,
ALTER COLUMN "normalizedScore" DROP NOT NULL,
ALTER COLUMN "rank" DROP NOT NULL;
