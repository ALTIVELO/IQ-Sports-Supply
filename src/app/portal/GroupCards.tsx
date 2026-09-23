import Link from 'next/link';
import ProductImage from '@/components/ProductImage';

export interface GroupCard {
  slug: string; name: string; brand: string | null;
  image_url: string | null; stepCount: number; optionCount: number;
}

/**
 * Groups shown above the plain products in a collection.
 *
 * A tyre sold in five sizes should be one thing to click, not five near
 * identical rows to compare; a groupset to spec is not a row at all. Both sit
 * at the top of the collection they belong to, because that is where someone
 * shopping for a tyre is already looking.
 */
export default function GroupCards({
  groups, heading = 'Choose your specification',
}: {
  groups: GroupCard[];
  /**
   * What to call the row.
   *
   * A collection is introducing these for the first time; a builder showing
   * its siblings at the foot is doing something else and says so. The heading
   * belongs to the component so the two never drift apart in weight or
   * spacing.
   */
  heading?: string;
}) {
  if (!groups.length) return null;

  return (
    <div className="space-y-2">
      <h2 className="text-[13px] font-semibold text-mute uppercase tracking-wide">
        {heading}
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {groups.map((g) => (
          <Link
            key={g.slug}
            href={`/portal/build/${g.slug}`}
            className="group block bg-white border border-line rounded-card overflow-hidden
                       hover:border-flame focus-visible:border-flame transition-colors"
          >
            <ProductImage
              src={g.image_url} alt=""
              className="w-full aspect-[5/3] border-0 border-b border-line rounded-none bg-parch"
              sizePx={320} placeholderScale="quiet"
            />
            <div className="p-3">
              <div className="text-[13px] font-semibold leading-tight">{g.name}</div>
              {g.brand && <div className="text-[12px] text-mute mt-0.5">{g.brand}</div>}
              <div className="text-[12px] text-mute mt-1">
                {g.stepCount > 1
                  ? `Build it yourself — ${g.stepCount} choices`
                  : `${g.optionCount} option${g.optionCount === 1 ? '' : 's'} to choose from`}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
