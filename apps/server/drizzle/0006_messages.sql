CREATE TABLE "messages" (
	"message_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"hand_id" uuid,
	"from_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_match_id_matches_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "matches"("match_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_hand_id_hands_hand_id_fk" FOREIGN KEY ("hand_id") REFERENCES "hands"("hand_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "messages" ADD CONSTRAINT "messages_from_user_id_users_user_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "users"("user_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX "messages_match_idx" ON "messages" ("match_id","created_at" DESC);
--> statement-breakpoint
CREATE INDEX "messages_hand_idx" ON "messages" ("hand_id","created_at" DESC) WHERE "hand_id" IS NOT NULL;
