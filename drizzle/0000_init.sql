CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" integer NOT NULL,
	"participant_id" uuid NOT NULL,
	"order_id" uuid,
	"waiver_id" uuid,
	"status" text NOT NULL,
	"payment_status" text NOT NULL,
	"waiver_status" text NOT NULL,
	"hold_expires_at" timestamp with time zone,
	"source" text NOT NULL,
	"booker_name" text,
	"booker_email" text,
	"booker_phone" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "class_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"duration_min" integer DEFAULT 60 NOT NULL,
	"age_group" text NOT NULL,
	"age_min" integer,
	"age_max" integer,
	"capacity" integer DEFAULT 10 NOT NULL,
	"price_cents" integer DEFAULT 2000 NOT NULL,
	CONSTRAINT "class_sessions_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_token" text NOT NULL,
	"booker_name" text NOT NULL,
	"booker_email" text NOT NULL,
	"booker_phone" text,
	"payment_method" text NOT NULL,
	"status" text NOT NULL,
	"net_cents" integer NOT NULL,
	"surcharge_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer NOT NULL,
	"stripe_session_id" text,
	"stripe_payment_intent" text,
	"hold_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "orders_public_token_unique" UNIQUE("public_token"),
	CONSTRAINT "orders_stripe_session_id_unique" UNIQUE("stripe_session_id")
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"date_of_birth" date,
	"phone" text,
	"email" text,
	"emergency_name" text,
	"emergency_phone" text,
	"health_notes" text,
	"health_none" boolean DEFAULT false NOT NULL,
	"guardian_name" text,
	"guardian_relationship" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waiver_versions" (
	"version" text PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"order_id" uuid,
	"waiver_version" text NOT NULL,
	"waiver_sha256" text NOT NULL,
	"fields" jsonb NOT NULL,
	"acknowledgements" jsonb NOT NULL,
	"participant_signature" text NOT NULL,
	"under_18" boolean NOT NULL,
	"guardian_name" text,
	"guardian_relationship" text,
	"guardian_signature" text,
	"signed_at_utc" timestamp with time zone NOT NULL,
	"signed_at_perth" text NOT NULL,
	"ip_address" text
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_session_id_class_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."class_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_waiver_id_waivers_id_fk" FOREIGN KEY ("waiver_id") REFERENCES "public"."waivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waivers" ADD CONSTRAINT "waivers_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waivers" ADD CONSTRAINT "waivers_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waivers" ADD CONSTRAINT "waivers_waiver_version_waiver_versions_version_fk" FOREIGN KEY ("waiver_version") REFERENCES "public"."waiver_versions"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_session_status_idx" ON "bookings" USING btree ("session_id","status");--> statement-breakpoint
CREATE INDEX "bookings_order_idx" ON "bookings" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_one_live_spot_per_participant" ON "bookings" USING btree ("session_id","participant_id") WHERE status in ('held', 'confirmed');