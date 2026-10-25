ALTER TABLE "quota_usage" ALTER COLUMN "skill" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "user_limits" ADD COLUMN "subscribed_until" timestamp with time zone;--> statement-breakpoint
-- LiveKit sessions were reserved as 'speaking' under the live session id: they count as examiner sessions now.
UPDATE "quota_usage" SET "skill" = 'examiner' WHERE "skill" = 'speaking' AND "unit_key" IN (SELECT "id" FROM "live_sessions");
