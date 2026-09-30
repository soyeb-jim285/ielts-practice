ALTER TABLE "attempts" ADD COLUMN "error_retryable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "attempts_user_prompt_idx" ON "attempts" USING btree ("user_id","prompt_id");--> statement-breakpoint
CREATE INDEX "cards_user_front_idx" ON "cards" USING btree ("user_id","front");--> statement-breakpoint
CREATE INDEX "live_sessions_user_idx" ON "live_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mistakes_attempt_idx" ON "mistakes" USING btree ("attempt_id");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");