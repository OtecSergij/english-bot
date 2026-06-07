--> text[] → text: keep the first (primary) element of any existing rows.
ALTER TABLE "words" ALTER COLUMN "english" SET DATA TYPE text USING "english"[1];