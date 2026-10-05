CREATE TABLE "cambridge_access" (
	"email" text PRIMARY KEY NOT NULL,
	"granted_by" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"email" text,
	"message" text NOT NULL,
	"page" text NOT NULL,
	"replay_session_id" text,
	"user_agent" text,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guest_conversions" (
	"guest_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"guest_created_at" timestamp with time zone NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "replay_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL,
	"chunks" integer DEFAULT 0 NOT NULL,
	"user_agent" text
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_conversions" ADD CONSTRAINT "guest_conversions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replay_sessions" ADD CONSTRAINT "replay_sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_status_created_idx" ON "feedback" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "guest_conversions_linked_idx" ON "guest_conversions" USING btree ("linked_at");--> statement-breakpoint
CREATE INDEX "replay_sessions_user_idx" ON "replay_sessions" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "replay_sessions_last_idx" ON "replay_sessions" USING btree ("last_at");--> statement-breakpoint
CREATE INDEX "attempts_status_updated_idx" ON "attempts" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "attempts_created_idx" ON "attempts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "lr_attempts_started_idx" ON "lr_attempts" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "user_created_idx" ON "user" USING btree ("created_at");