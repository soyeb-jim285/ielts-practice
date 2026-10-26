CREATE TABLE "plan_reminders" (
	"user_id" text NOT NULL,
	"until" timestamp with time zone NOT NULL,
	"days" integer NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_reminders_user_id_until_days_pk" PRIMARY KEY("user_id","until","days")
);
--> statement-breakpoint
ALTER TABLE "plan_reminders" ADD CONSTRAINT "plan_reminders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;