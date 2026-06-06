CREATE TYPE "public"."word_source" AS ENUM('dictionary', 'fallback');--> statement-breakpoint
CREATE TABLE "settings" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"review_count" integer DEFAULT 10 NOT NULL,
	"review_time" time DEFAULT '09:00' NOT NULL,
	"test_count" integer DEFAULT 10 NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"tg_chat_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_tg_chat_id_unique" UNIQUE("tg_chat_id")
);
--> statement-breakpoint
CREATE TABLE "words" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"russian" text NOT NULL,
	"english" text[] NOT NULL,
	"example_ru" text,
	"example_en" text,
	"source" "word_source" NOT NULL,
	"next_review" date NOT NULL,
	"interval_index" integer DEFAULT 0 NOT NULL,
	"last_tested" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "words" ADD CONSTRAINT "words_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "words_review_idx" ON "words" USING btree ("user_id","next_review");--> statement-breakpoint
CREATE INDEX "words_test_idx" ON "words" USING btree ("user_id","last_tested");