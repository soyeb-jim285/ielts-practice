ALTER TABLE "quota_usage" ADD COLUMN "members" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "quota_usage" ADD COLUMN "refunds" integer DEFAULT 0 NOT NULL;