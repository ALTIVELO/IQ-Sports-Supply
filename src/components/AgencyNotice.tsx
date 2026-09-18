import { agencyHeading, agencyLines } from '@/lib/orders/agency';

/**
 * Who is actually selling these goods, on an order we only introduced.
 *
 * Deliberately not a muted footnote. On a DRAG order the customer is buying
 * from DRAG: DRAG confirms it, DRAG raises the final invoice with shipping
 * and taxes on it, and DRAG carries the warranty and the product liability.
 * A customer who does not read that has been told nothing, so it is set off
 * from the page rather than tucked under it.
 *
 * Every surface that shows an order renders this same component off the same
 * snapshotted text, so the basket, the confirmation, the portal and the PDF
 * cannot end up saying three different things.
 */
export default function AgencyNotice({
  terms, brand, company, className = '',
}: {
  terms: string | null | undefined;
  brand: string | null | undefined;
  company: string;
  className?: string;
}) {
  const lines = agencyLines(terms, { brand: brand || 'the brand', company });
  if (!lines.length) return null;

  return (
    <div className={`border border-flame rounded bg-parch px-3.5 py-3 ${className}`}>
      <div className="text-[12px] font-semibold uppercase tracking-wide">
        {agencyHeading({ brand: brand || 'the brand', company })}
      </div>
      <ul className="mt-1.5 space-y-1">
        {lines.map((line) => (
          <li key={line} className="text-[12px] leading-relaxed text-ink">{line}</li>
        ))}
      </ul>
    </div>
  );
}
