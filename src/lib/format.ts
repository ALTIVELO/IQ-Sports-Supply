/** Presentation helpers, matching the prototype's formatting exactly. */

export const money = (n: number | string | null | undefined) =>
  '£' +
  (Number(n) || 0).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export const today = () => new Date().toISOString().slice(0, 10);

export const addDays = (d: string, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x.toISOString().slice(0, 10);
};

export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export const fmtDateTime = (d: string | null | undefined) =>
  d
    ? new Date(d).toLocaleString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '—';

export const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export const csv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\n');

/** Net / VAT / gross for a set of invoice lines. */
export function totals(lines: { qty: number; unit_price: number | string }[], vatRate: number) {
  const net = lines.reduce((a, l) => a + l.qty * Number(l.unit_price), 0);
  const vat = (net * Number(vatRate)) / 100;
  return { net, vat, gross: net + vat };
}

/** Well-known carriers get a real tracking link; anything else falls back to a search. */
export function trackingUrlFor(carrier: string, tracking: string): string {
  const t = encodeURIComponent(tracking.trim());
  const c = carrier.trim().toLowerCase();
  if (c.includes('dpd')) return `https://track.dpd.co.uk/search?reference=${t}`;
  if (c.includes('dhl')) return `https://www.dhl.com/gb-en/home/tracking.html?tracking-id=${t}`;
  if (c.includes('ups')) return `https://www.ups.com/track?tracknum=${t}`;
  if (c.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${t}`;
  if (c.includes('parcelforce')) return `https://www.parcelforce.com/track-trace?trackNumber=${t}`;
  if (c.includes('royal')) return `https://www.royalmail.com/track-your-item#/tracking-results/${t}`;
  if (c.includes('evri') || c.includes('hermes')) return `https://www.evri.com/track/parcel/${t}`;
  return `https://www.google.com/search?q=${encodeURIComponent(carrier + ' tracking ' + tracking)}`;
}
