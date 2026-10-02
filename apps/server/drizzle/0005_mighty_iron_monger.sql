CREATE TABLE "solver_meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "solver_strategies" (
	"depth_bb" integer NOT NULL,
	"street" integer NOT NULL,
	"seq" text NOT NULL,
	"bucket" integer NOT NULL,
	"tokens" jsonb NOT NULL,
	"strategy" jsonb NOT NULL,
	CONSTRAINT "solver_strategies_depth_bb_street_seq_bucket_pk" PRIMARY KEY("depth_bb","street","seq","bucket")
);
