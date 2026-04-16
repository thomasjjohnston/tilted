CREATE TABLE "actions" (
	"action_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hand_id" uuid NOT NULL,
	"street" text NOT NULL,
	"acting_user_id" uuid NOT NULL,
	"action_type" text NOT NULL,
	"amount" integer DEFAULT 0 NOT NULL,
	"pot_after" integer NOT NULL,
	"client_tx_id" text NOT NULL,
	"client_sent_at" timestamp with time zone,
	"server_recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "actions_idempotency_idx" UNIQUE("hand_id","client_tx_id"),
	CONSTRAINT "actions_type_check" CHECK ("actions"."action_type" in ('fold', 'check', 'call', 'bet', 'raise', 'all_in'))
);
--> statement-breakpoint
CREATE TABLE "app_events" (
	"event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "debug_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "favorites" (
	"user_id" uuid NOT NULL,
	"hand_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favorites_user_id_hand_id_pk" PRIMARY KEY("user_id","hand_id")
);
--> statement-breakpoint
CREATE TABLE "hands" (
	"hand_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"hand_index" integer NOT NULL,
	"deck_seed" text NOT NULL,
	"user_a_hole" jsonb NOT NULL,
	"user_b_hole" jsonb NOT NULL,
	"board" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pot" integer DEFAULT 0 NOT NULL,
	"user_a_reserved" integer DEFAULT 0 NOT NULL,
	"user_b_reserved" integer DEFAULT 0 NOT NULL,
	"street" text NOT NULL,
	"action_on_user_id" uuid,
	"status" text NOT NULL,
	"terminal_reason" text,
	"winner_user_id" uuid,
	"completed_at" timestamp with time zone,
	CONSTRAINT "hands_round_hand_idx" UNIQUE("round_id","hand_index"),
	CONSTRAINT "hands_index_check" CHECK ("hands"."hand_index" between 0 and 9),
	CONSTRAINT "hands_street_check" CHECK ("hands"."street" in ('preflop', 'flop', 'turn', 'river', 'showdown', 'complete')),
	CONSTRAINT "hands_status_check" CHECK ("hands"."status" in ('in_progress', 'awaiting_runout', 'complete'))
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"match_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_a_id" uuid NOT NULL,
	"user_b_id" uuid NOT NULL,
	"starting_stack" integer DEFAULT 2000 NOT NULL,
	"blind_small" integer DEFAULT 5 NOT NULL,
	"blind_big" integer DEFAULT 10 NOT NULL,
	"status" text NOT NULL,
	"winner_user_id" uuid,
	"sb_of_round_1" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"user_a_total" integer NOT NULL,
	"user_b_total" integer NOT NULL,
	CONSTRAINT "matches_status_check" CHECK ("matches"."status" in ('active', 'ended'))
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"round_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"round_index" integer NOT NULL,
	"sb_user_id" uuid NOT NULL,
	"bb_user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "rounds_match_round_idx" UNIQUE("match_id","round_index"),
	CONSTRAINT "rounds_status_check" CHECK ("rounds"."status" in ('dealing', 'in_progress', 'revealing', 'complete'))
);
--> statement-breakpoint
CREATE TABLE "turn_handoffs" (
	"handoff_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"fired_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"user_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"apns_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_hand_id_hands_hand_id_fk" FOREIGN KEY ("hand_id") REFERENCES "public"."hands"("hand_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_acting_user_id_users_user_id_fk" FOREIGN KEY ("acting_user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_events" ADD CONSTRAINT "app_events_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debug_tokens" ADD CONSTRAINT "debug_tokens_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_hand_id_hands_hand_id_fk" FOREIGN KEY ("hand_id") REFERENCES "public"."hands"("hand_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hands" ADD CONSTRAINT "hands_round_id_rounds_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("round_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hands" ADD CONSTRAINT "hands_action_on_user_id_users_user_id_fk" FOREIGN KEY ("action_on_user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hands" ADD CONSTRAINT "hands_winner_user_id_users_user_id_fk" FOREIGN KEY ("winner_user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_user_a_id_users_user_id_fk" FOREIGN KEY ("user_a_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_user_b_id_users_user_id_fk" FOREIGN KEY ("user_b_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_winner_user_id_users_user_id_fk" FOREIGN KEY ("winner_user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_sb_of_round_1_users_user_id_fk" FOREIGN KEY ("sb_of_round_1") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_match_id_matches_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("match_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_sb_user_id_users_user_id_fk" FOREIGN KEY ("sb_user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_bb_user_id_users_user_id_fk" FOREIGN KEY ("bb_user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turn_handoffs" ADD CONSTRAINT "turn_handoffs_round_id_rounds_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("round_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turn_handoffs" ADD CONSTRAINT "turn_handoffs_from_user_id_users_user_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turn_handoffs" ADD CONSTRAINT "turn_handoffs_to_user_id_users_user_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "matches_one_active_idx" ON "matches" USING btree ("status") WHERE "matches"."status" = 'active';