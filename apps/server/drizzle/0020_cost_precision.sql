ALTER TABLE "ai_costs" ALTER COLUMN "cost_usd" SET DATA TYPE numeric(20, 12);--> statement-breakpoint
ALTER TABLE "ai_logs" ALTER COLUMN "cost_usd" SET DATA TYPE numeric(20, 12);