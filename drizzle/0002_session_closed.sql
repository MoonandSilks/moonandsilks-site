ALTER TABLE "class_sessions" ADD COLUMN IF NOT EXISTS "closed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Sat 12 Dec 2026, 11:00 Teens & adults: booked out as a homeschool group. Existing bookings are not touched.
UPDATE "class_sessions" SET "closed" = true WHERE "slug" = '2026-12-12-1100';
