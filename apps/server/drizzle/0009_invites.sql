CREATE TABLE "invites" (
	"invite_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"inviter_user_id" uuid NOT NULL,
	"client_tx_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_by_user_id" uuid,
	"redeemed_at" timestamp with time zone,
	"match_id" uuid,
	CONSTRAINT "invites_code_unique" UNIQUE("code"),
	CONSTRAINT "invites_idempotency_idx" UNIQUE("inviter_user_id","client_tx_id")
);
--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_inviter_user_id_users_user_id_fk" FOREIGN KEY ("inviter_user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_redeemed_by_user_id_users_user_id_fk" FOREIGN KEY ("redeemed_by_user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_match_id_matches_match_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("match_id") ON DELETE no action ON UPDATE no action;