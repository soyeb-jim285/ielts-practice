CREATE TABLE "coach_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"report_id" text NOT NULL,
	"item_key" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"day" text NOT NULL,
	"last_test_at" timestamp with time zone NOT NULL,
	"facts" jsonb NOT NULL,
	"words" jsonb NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_weekly" (
	"user_id" text NOT NULL,
	"week" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coach_weekly_user_id_week_pk" PRIMARY KEY("user_id","week")
);
--> statement-breakpoint
ALTER TABLE "coach_feedback" ADD CONSTRAINT "coach_feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_feedback" ADD CONSTRAINT "coach_feedback_report_id_coach_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."coach_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_reports" ADD CONSTRAINT "coach_reports_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_weekly" ADD CONSTRAINT "coach_weekly_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coach_feedback_report_item_idx" ON "coach_feedback" USING btree ("report_id","item_key");--> statement-breakpoint
CREATE UNIQUE INDEX "coach_reports_user_day_idx" ON "coach_reports" USING btree ("user_id","day");--> statement-breakpoint
CREATE INDEX "coach_reports_user_created_idx" ON "coach_reports" USING btree ("user_id","created_at");