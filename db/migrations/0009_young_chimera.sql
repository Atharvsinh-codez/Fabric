ALTER TABLE "boards" DROP CONSTRAINT "boards_archive_status_check";--> statement-breakpoint
ALTER TABLE "boards" DROP CONSTRAINT "boards_status_check";--> statement-breakpoint
UPDATE "boards" SET "status" = 'active' WHERE "status" = 'archived';--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_status_check" CHECK ("boards"."status" in ('draft', 'active', 'review', 'approved'));
