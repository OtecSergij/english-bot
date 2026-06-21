ALTER TABLE "settings" ADD COLUMN "session_size" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "new_per_day" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "words" ADD COLUMN "lapses" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "backlog_strikes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ahead_strikes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "settings" SET "session_size" = "review_count";--> statement-breakpoint
UPDATE "words" SET "last_tested" = "created_at" WHERE "last_tested" IS NULL AND "interval_index" > 0;--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "review_count";--> statement-breakpoint
ALTER TABLE "settings" DROP COLUMN "test_count";