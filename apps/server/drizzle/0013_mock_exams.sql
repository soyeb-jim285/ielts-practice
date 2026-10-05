CREATE TABLE "mock_exams" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"variant" "variant" NOT NULL,
	"source" text NOT NULL,
	"ref" text,
	"listening_test_id" text NOT NULL,
	"reading_test_id" text NOT NULL,
	"writing_prompt_ids" text[] NOT NULL,
	"speaking_prompt_ids" text[],
	"listening_attempt_id" text,
	"reading_attempt_id" text,
	"writing_session_id" text NOT NULL,
	"writing_attempt_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"writing_started_at" timestamp with time zone,
	"writing_elapsed_s" integer DEFAULT 0 NOT NULL,
	"speaking_mode" text,
	"speaking_session_id" text,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "mock_exams" ADD CONSTRAINT "mock_exams_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_exams" ADD CONSTRAINT "mock_exams_listening_test_id_lr_tests_id_fk" FOREIGN KEY ("listening_test_id") REFERENCES "public"."lr_tests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_exams" ADD CONSTRAINT "mock_exams_reading_test_id_lr_tests_id_fk" FOREIGN KEY ("reading_test_id") REFERENCES "public"."lr_tests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mock_exams_user_started_idx" ON "mock_exams" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mock_exams_one_open_idx" ON "mock_exams" USING btree ("user_id") WHERE status = 'in_progress';