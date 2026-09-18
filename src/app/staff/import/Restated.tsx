'use client';

import { Card } from '@/components/ui';
import { restatementLabel } from '@/lib/import/overwrite';
import type { CataloguePreview } from '@/lib/import/types';

/**
 * What this file would change about the products we already hold.
 *
 * Its own card, because it is the part of an import nobody was being shown.
 * The price cards said what the money would do; everything else — a renamed
 * product, a re-filed one, a photograph replaced — happened on Apply without
 * having been described. A list that renames half a catalogue should say so
 * beforehand, and it is worked out by the rule the apply then runs, so the
 * two cannot disagree.
 */
export default function Restated({ preview }: { preview: CataloguePreview }) {
  const most = Math.max(...preview.restated.map((r) => r.rows));

  return (
    <Card>
      <div className="text-[12px] font-semibold mb-1">
        Changes to SKUs we already hold ({most} at most)
      </div>
      <p className="text-[12px] text-mute mb-2 max-w-2xl leading-relaxed">
        A supplier&rsquo;s list is the authority on their own products, so what it
        states replaces what we hold. Nothing here touches a price.
      </p>

      <ul className="text-[12px] space-y-0.5 mb-3">
        {preview.restated.map((r) => (
          <li key={r.field}>
            <span className="num font-semibold">{r.rows}</span>{' '}
            {restatementLabel(r.field as never, r.rows)}
          </li>
        ))}
      </ul>

      {preview.restatedExamples.length > 0 && (
        <div className="border-t border-row-line pt-2 space-y-1">
          {/* A handful written out, so the rule can be seen working rather
              than taken on trust from a count. */}
          {preview.restatedExamples.map((e, i) => (
            <div key={`${e.sku}-${e.field}-${i}`}
                 className="text-[11px] text-mute flex flex-wrap gap-x-1.5">
              <span className="num font-semibold text-ink">{e.sku}</span>
              <span>{e.field}:</span>
              <span className="line-through">{e.from ?? '—'}</span>
              <span aria-hidden>→</span>
              <span className={e.to === null ? 'text-danger' : 'text-ink'}>
                {e.to ?? 'cleared'}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
