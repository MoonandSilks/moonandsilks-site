import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** One class session (one hour, one age group). */
export const classSessions = pgTable('class_sessions', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(), // e.g. 2026-11-28-0900
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  durationMin: integer('duration_min').notNull().default(60),
  ageGroup: text('age_group').notNull(),
  ageMin: integer('age_min'),
  ageMax: integer('age_max'),
  capacity: integer('capacity').notNull().default(10),
  priceCents: integer('price_cents').notNull().default(2000),
  /** Closed to new public bookings (set in /admin). Existing bookings stay. */
  closed: boolean('closed').notNull().default(false),
});

/** Exact waiver wording, keyed by version, so every signature points at the words it agreed to. */
export const waiverVersions = pgTable('waiver_versions', {
  version: text('version').primaryKey(),
  text: text('text').notNull(),
  sha256: text('sha256').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** One checkout by one booker (web), or a manual/imported group. */
export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    publicToken: text('public_token').notNull().unique(),
    bookerName: text('booker_name').notNull(),
    bookerEmail: text('booker_email').notNull(),
    bookerPhone: text('booker_phone'),
    paymentMethod: text('payment_method').notNull(), // card | cash
    status: text('status').notNull(), // pending | confirmed | expired | cancelled | refunded | refund_needed
    netCents: integer('net_cents').notNull(),
    surchargeCents: integer('surcharge_cents').notNull().default(0),
    totalCents: integer('total_cents').notNull(),
    stripeSessionId: text('stripe_session_id').unique(),
    stripePaymentIntent: text('stripe_payment_intent'),
    holdExpiresAt: timestamp('hold_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  },
);

/** A person who attends classes. Health data lives here and in waivers only. */
export const participants = pgTable('participants', {
  id: uuid('id').primaryKey().defaultRandom(),
  fullName: text('full_name').notNull(),
  dateOfBirth: date('date_of_birth', { mode: 'string' }),
  phone: text('phone'),
  email: text('email'),
  emergencyName: text('emergency_name'),
  emergencyPhone: text('emergency_phone'),
  /** null = nothing recorded; use healthNone to tell "signed None" apart. */
  healthNotes: text('health_notes'),
  healthNone: boolean('health_none').notNull().default(false),
  guardianName: text('guardian_name'),
  guardianRelationship: text('guardian_relationship'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** A signed online waiver. Self-contained snapshot of every value at signing time. */
export const waivers = pgTable('waivers', {
  id: uuid('id').primaryKey().defaultRandom(),
  participantId: uuid('participant_id')
    .notNull()
    .references(() => participants.id),
  orderId: uuid('order_id').references(() => orders.id),
  waiverVersion: text('waiver_version')
    .notNull()
    .references(() => waiverVersions.version),
  waiverSha256: text('waiver_sha256').notNull(),
  fields: jsonb('fields').notNull(), // participant details exactly as submitted
  acknowledgements: jsonb('acknowledgements').notNull(),
  participantSignature: text('participant_signature').notNull(),
  under18: boolean('under_18').notNull(),
  guardianName: text('guardian_name'),
  guardianRelationship: text('guardian_relationship'),
  guardianSignature: text('guardian_signature'),
  signedAtUtc: timestamp('signed_at_utc', { withTimezone: true }).notNull(),
  signedAtPerth: text('signed_at_perth').notNull(),
  ipAddress: text('ip_address'),
});

/** One participant in one session. Counts towards capacity when confirmed or held (unexpired). */
export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: integer('session_id')
      .notNull()
      .references(() => classSessions.id),
    participantId: uuid('participant_id')
      .notNull()
      .references(() => participants.id),
    orderId: uuid('order_id').references(() => orders.id),
    waiverId: uuid('waiver_id').references(() => waivers.id),
    status: text('status').notNull(), // held | confirmed | expired | cancelled
    paymentStatus: text('payment_status').notNull(), // pending | paid_card | cash_due | cash_received
    waiverStatus: text('waiver_status').notNull(), // online | paper | missing
    holdExpiresAt: timestamp('hold_expires_at', { withTimezone: true }),
    source: text('source').notNull(), // web | admin | import
    bookerName: text('booker_name'),
    bookerEmail: text('booker_email'),
    bookerPhone: text('booker_phone'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  },
  (t) => [
    index('bookings_session_status_idx').on(t.sessionId, t.status),
    index('bookings_order_idx').on(t.orderId),
    // A participant cannot hold two live spots in the same session.
    uniqueIndex('bookings_one_live_spot_per_participant')
      .on(t.sessionId, t.participantId)
      .where(sql`status in ('held', 'confirmed')`),
  ],
);

/** Stripe webhook events already handled, so a redelivered event is ignored. */
export const stripeEvents = pgTable('stripe_events', {
  id: text('id').primaryKey(), // evt_…
  type: text('type').notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
});
