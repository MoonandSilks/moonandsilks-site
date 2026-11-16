// Server-only configuration. Read at request time so Vercel env changes apply on redeploy.
const read = (name: string): string | undefined => {
  const v = (typeof process !== 'undefined' ? process.env[name] : undefined) ?? (import.meta.env?.[name] as string | undefined);
  return v && v.trim() !== '' ? v.trim() : undefined;
};

export const env = {
  get databaseUrl() {
    return read('DATABASE_URL') ?? read('POSTGRES_URL');
  },
  get stripeSecretKey() {
    return read('STRIPE_SECRET_KEY');
  },
  get stripeWebhookSecret() {
    return read('STRIPE_WEBHOOK_SECRET');
  },
  /** Percent, e.g. 1.65 for 1.65% (Stripe AU domestic cards). Must not exceed Natascha's real Stripe cost. */
  get feePercent() {
    return Number(read('STRIPE_FEE_PERCENT') ?? '1.65');
  },
  /** Fixed fee in dollars, e.g. 0.30. */
  get feeFixedCents() {
    return Math.round(Number(read('STRIPE_FEE_FIXED') ?? '0.30') * 100);
  },
  get adminPassword() {
    return read('ADMIN_PASSWORD');
  },
  get authSecret() {
    return read('AUTH_SECRET');
  },
  get resendApiKey() {
    return read('RESEND_API_KEY');
  },
  get emailFrom() {
    return read('EMAIL_FROM');
  },
  get siteUrl() {
    return read('SITE_URL') ?? 'https://www.moonandsilks.com';
  },
};

/**
 * Card hold length. Stripe Checkout's shortest allowed expiry is 30 minutes after creation, so the hold and the
 * Session share one deadline: 30 minutes plus a 1-minute margin for the time between placing the hold and
 * Stripe creating the Session.
 */
export const HOLD_MINUTES = 31;
export const TIMEZONE = 'Australia/Perth';
