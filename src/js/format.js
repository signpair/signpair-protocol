const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 });
const pct = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const DASH = '—';

export function price(v) {
  if (!Number.isFinite(v)) return DASH;
  if (v >= 1000) return usd0.format(v);
  if (v >= 1) return usd2.format(v);
  if (v === 0) return '$0.00';
  const digits = Math.min(10, Math.max(4, 3 - Math.floor(Math.log10(v))));
  return '$' + v.toFixed(digits);
}
export const money = (v) => (Number.isFinite(v) ? compact.format(v) : DASH);
export const count = (v) => (Number.isFinite(v) ? String(Math.round(v)) : DASH);
export function change(v) {
  if (!Number.isFinite(v)) return DASH;
  return (v > 0 ? '▲ ' : v < 0 ? '▼ ' : '') + pct.format(Math.abs(v)) + '%';
}
