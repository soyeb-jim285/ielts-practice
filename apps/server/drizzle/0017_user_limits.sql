CREATE TABLE "user_limits" (
	"user_id" text PRIMARY KEY NOT NULL,
	"speaking" integer,
	"writing" integer,
	"unlimited" boolean DEFAULT false NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_limits" ADD CONSTRAINT "user_limits_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;