-- AlterTable
ALTER TABLE "Webhook" ADD COLUMN     "format" TEXT NOT NULL DEFAULT 'standard';


ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_format_check" CHECK ("format" IN ('standard', 'slack', 'discord'));
