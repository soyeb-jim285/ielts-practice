CREATE TABLE "lr_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"test_id" text NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"responses" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"elapsed_s" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"raw" integer,
	"total" integer,
	"band" numeric,
	"marks" jsonb
);
--> statement-breakpoint
CREATE TABLE "lr_tests" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"skill" text NOT NULL,
	"variant" text NOT NULL,
	"source" text NOT NULL,
	"ref" text NOT NULL,
	"title" text NOT NULL,
	"data" jsonb NOT NULL,
	"restricted" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lr_tests_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "lr_attempts" ADD CONSTRAINT "lr_attempts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lr_attempts" ADD CONSTRAINT "lr_attempts_test_id_lr_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."lr_tests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lr_attempts_user_started_idx" ON "lr_attempts" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "lr_attempts_user_test_idx" ON "lr_attempts" USING btree ("user_id","test_id","status");--> statement-breakpoint
CREATE INDEX "lr_tests_skill_source_idx" ON "lr_tests" USING btree ("skill","source");