CREATE TABLE "ai_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" text,
	"attempt_id" text,
	"session_id" text,
	"stage" text NOT NULL,
	"path" text NOT NULL,
	"model" text,
	"served" text,
	"ok" boolean NOT NULL,
	"status" integer,
	"latency_ms" integer NOT NULL,
	"cost_usd" numeric(12, 6),
	"request" jsonb,
	"response" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE INDEX "ai_logs_created_idx" ON "ai_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_logs_attempt_idx" ON "ai_logs" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "ai_logs_stage_created_idx" ON "ai_logs" USING btree ("stage","created_at");