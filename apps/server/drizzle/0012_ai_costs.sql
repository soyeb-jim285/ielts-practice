CREATE TABLE "ai_costs" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text,
	"attempt_id" text,
	"session_id" text,
	"prompt_id" text,
	"skill" text,
	"part" integer,
	"stage" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"paid_by" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"audio_seconds" numeric,
	"characters" integer,
	"credits" numeric,
	"cost_usd" numeric(12, 6) DEFAULT 0 NOT NULL,
	"ok" boolean DEFAULT true NOT NULL,
	"retry" boolean DEFAULT false NOT NULL,
	"meta" jsonb
);
--> statement-breakpoint
CREATE INDEX "ai_costs_created_idx" ON "ai_costs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_costs_user_created_idx" ON "ai_costs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_costs_attempt_idx" ON "ai_costs" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "ai_costs_stage_idx" ON "ai_costs" USING btree ("stage");