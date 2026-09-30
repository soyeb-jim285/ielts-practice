CREATE TABLE "scoring_calibrations" (
	"key" text PRIMARY KEY NOT NULL,
	"skill" "skill" NOT NULL,
	"model_id" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"effort" text NOT NULL,
	"k" integer NOT NULL,
	"provider" text,
	"form" text NOT NULL,
	"slope" real NOT NULL,
	"intercept" real NOT NULL,
	"m_lo" real,
	"m_hi" real,
	"lambda" real,
	"q90" real NOT NULL,
	"q95" real,
	"cv" jsonb,
	"script_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scoring_scripts" (
	"id" text PRIMARY KEY NOT NULL,
	"skill" "skill" NOT NULL,
	"task_family" text NOT NULL,
	"role" text NOT NULL,
	"split" text NOT NULL,
	"band" real,
	"group_id" text NOT NULL,
	"prompt" jsonb,
	"text" text,
	"audio_key" text,
	"note" text,
	"expect" jsonb,
	"source" text NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "scoring_calibrations_lookup_idx" ON "scoring_calibrations" USING btree ("model_id","prompt_hash","effort","k");--> statement-breakpoint
CREATE INDEX "scoring_scripts_skill_split_idx" ON "scoring_scripts" USING btree ("skill","split","role");