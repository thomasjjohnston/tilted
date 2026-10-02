ALTER TABLE "matches" DROP CONSTRAINT "matches_status_check";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_status_check" CHECK ("matches"."status" in ('active', 'ended', 'abandoned'));