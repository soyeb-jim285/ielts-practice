CREATE TABLE "stt_playground_runs" (
	"key" text PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
