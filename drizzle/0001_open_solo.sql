CREATE TABLE "ai-thing_session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai-thing_user" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai-thing_user_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "ai-thing_session" ADD CONSTRAINT "ai-thing_session_user_id_ai-thing_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."ai-thing_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "ai-thing_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_username_idx" ON "ai-thing_user" USING btree ("username");