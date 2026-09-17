'use client';

import type { CategoryLite, CollectionGroup } from '@/lib/catalogue/collections';

/**
 * Two rows of chips: departments, then the collections inside the one chosen.
 *
 * The staff catalogue is a few thousand SKUs and the order desk is the same
 * catalogue seen through a phone call. Both had only a search box, which is
 * fine when you know the part number and useless when the customer says "what
 * gravel bikes do you have". This is the answer to that question.
 *
 * Counts are shown because an empty collection is worth seeing before it is
 * clicked — the range is listed whether or not it has been priced yet, so a
 * zero here means "not stocked" rather than "not sold".
 */
export default function CollectionPicker({
  groups, uncategorised, value, onChange, label = 'Collection',
}: {
  groups: CollectionGroup[];
  /** SKUs filed nowhere, offered as a collection of their own when there are any. */
  uncategorised: number;
  /** The chosen category's slug, 'none' for the unfiled, or null for everything. */
  value: string | null;
  onChange: (slug: string | null) => void;
  label?: string;
}) {
  const chosen = value === 'none'
    ? null
    : groups.find((g) => g.department.slug === value)
      ?? groups.find((g) => g.collections.some((c) => c.slug === value))
      ?? null;

  const chip = (active: boolean) =>
    `text-[12px] font-semibold rounded px-[10px] py-[5px] border whitespace-nowrap
     ${active ? 'bg-ink text-white border-ink' : 'bg-white border-line hover:bg-parch'}`;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold text-mute uppercase tracking-wide mr-1">
          {label}
        </span>
        <button type="button" className={chip(value === null)} onClick={() => onChange(null)}>
          All
        </button>
        {groups.map((g) => (
          <button
            key={g.department.slug}
            type="button"
            className={chip(chosen?.department.id === g.department.id)}
            onClick={() => onChange(g.department.slug)}
          >
            {g.department.name}
            <span className="num font-normal opacity-60"> {g.department.total}</span>
          </button>
        ))}
        {uncategorised > 0 && (
          <button
            type="button"
            className={chip(value === 'none')}
            onClick={() => onChange('none')}
            title="SKUs filed under no collection, so no customer filter reaches them"
          >
            Unfiled
            <span className="num font-normal opacity-60"> {uncategorised}</span>
          </button>
        )}
      </div>

      {/* Only once a department is open: showing every collection at once is
          seventy chips, which is a wall rather than a choice. */}
      {chosen && chosen.collections.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pl-1">
          <button
            type="button"
            className={chip(value === chosen.department.slug)}
            onClick={() => onChange(chosen.department.slug)}
          >
            Everything in {chosen.department.name}
          </button>
          {chosen.collections.map((c) => (
            <button
              key={c.slug}
              type="button"
              className={chip(value === c.slug)}
              onClick={() => onChange(c.slug)}
            >
              {c.name}
              <span className="num font-normal opacity-60"> {c.total}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** What the chosen slug is called, for a screen that says what it is showing. */
export function collectionName(
  categories: CategoryLite[], slug: string | null,
): string | null {
  if (slug === 'none') return 'Unfiled';
  return categories.find((c) => c.slug === slug)?.name ?? null;
}
