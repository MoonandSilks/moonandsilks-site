/**
 * Card surcharge that passes Stripe's fee through at cost (lawful in Australia only up to the cost of acceptance).
 * gross = (net + fixed) / (1 - percent); rounded up to the cent so the owner nets at least `net`
 * and the surcharge is never more than one cent above the exact pass-through.
 */
export function cardSurchargeCents(netCents: number, feePercent: number, feeFixedCents: number): number {
  if (netCents <= 0) return 0;
  if (!(feePercent >= 0 && feePercent < 100) || !(feeFixedCents >= 0)) throw new Error('Invalid Stripe fee settings');
  const gross = Math.ceil((netCents + feeFixedCents) / (1 - feePercent / 100));
  return gross - netCents;
}

export function formatAud(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
