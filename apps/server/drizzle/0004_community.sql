CREATE TYPE "public"."key_provider" AS ENUM('openrouter', 'openai', 'gemini');--> statement-breakpoint
CREATE TABLE "quota_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"skill" "skill" NOT NULL,
	"unit_key" text NOT NULL,
	"tier" text NOT NULL,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"refunded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" "key_provider" NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"last4" text NOT NULL,
	"valid" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "is_anonymous" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "quota_usage" ADD CONSTRAINT "quota_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_api_keys" ADD CONSTRAINT "user_api_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quota_usage_unit_idx" ON "quota_usage" USING btree ("user_id","skill","unit_key");--> statement-breakpoint
CREATE INDEX "quota_usage_user_idx" ON "quota_usage" USING btree ("user_id","skill","created_at");--> statement-breakpoint
CREATE INDEX "quota_usage_ip_idx" ON "quota_usage" USING btree ("ip_hash","skill","created_at");--> statement-breakpoint
CREATE INDEX "quota_usage_created_idx" ON "quota_usage" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_api_keys_user_provider_idx" ON "user_api_keys" USING btree ("user_id","provider");