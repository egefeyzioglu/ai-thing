CREATE TABLE "ai-thing_reference" (
	"id" text PRIMARY KEY NOT NULL,
	"url" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
