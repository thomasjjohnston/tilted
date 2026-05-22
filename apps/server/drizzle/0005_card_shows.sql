ALTER TABLE "hands" ADD COLUMN "shown_indices_by_a" integer[] DEFAULT '{}'::integer[] NOT NULL;--> statement-breakpoint
ALTER TABLE "hands" ADD COLUMN "shown_indices_by_b" integer[] DEFAULT '{}'::integer[] NOT NULL;
