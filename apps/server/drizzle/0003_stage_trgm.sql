CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "stage" text;--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "partial" jsonb;--> statement-breakpoint
CREATE INDEX "prompts_title_trgm_idx" ON "prompts" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "prompts_body_trgm_idx" ON "prompts" USING gin ("body" gin_trgm_ops);