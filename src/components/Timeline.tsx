import { TIMELINE, type OrderEvent } from '@/lib/types';
import { fmtDateTime } from '@/lib/format';

/**
 * The live status timeline. Driven entirely by order_events — there is no
 * manually editable status anywhere.
 */
export default function Timeline({
  events, compact = false,
}: { events: OrderEvent[]; compact?: boolean }) {
  const byType = new Map<string, OrderEvent>();
  for (const e of events) {
    // Keep the latest occurrence of each stage.
    byType.set(e.type, e);
  }

  // "Ordered from supplier" and "Stock arrived" only belong on the timeline of
  // an order that actually had a back order.
  const stages = TIMELINE.filter(
    (s) => !['supplier_ordered', 'stock_arrived'].includes(s.type) || byType.has(s.type),
  );

  const lastDoneIndex = stages.reduce((acc, s, i) => (byType.has(s.type) ? i : acc), -1);

  return (
    <ol className={`flex ${compact ? 'flex-row flex-wrap gap-x-1 gap-y-2' : 'flex-col'} `}>
      {stages.map((stage, i) => {
        const event = byType.get(stage.type);
        const done = Boolean(event);
        const current = i === lastDoneIndex;

        if (compact) {
          return (
            <li key={stage.type} className="flex items-center gap-1">
              <span
                className={`w-2 h-2 rounded-full ${done ? (current ? 'bg-cobalt' : 'bg-success') : 'bg-line'}`}
                aria-hidden
              />
              <span className={`text-[11px] ${done ? 'text-ink font-medium' : 'text-mute'}`}>
                {stage.label}
              </span>
              {i < stages.length - 1 && <span className="text-line mx-0.5">›</span>}
            </li>
          );
        }

        const meta = event?.meta as Record<string, string> | undefined;
        return (
          <li key={stage.type} className="flex gap-3 pb-3 last:pb-0 relative">
            {i < stages.length - 1 && (
              <span
                className={`absolute left-[5px] top-4 bottom-0 w-px ${done ? 'bg-success' : 'bg-line'}`}
                aria-hidden
              />
            )}
            <span
              className={`w-[11px] h-[11px] rounded-full mt-1 flex-shrink-0 z-10
                ${done ? (current ? 'bg-cobalt ring-4 ring-cobalt/15' : 'bg-success') : 'bg-white border-2 border-line'}`}
              aria-hidden
            />
            <div className="min-w-0">
              <div className={`text-[13px] ${done ? 'font-semibold' : 'text-mute'}`}>{stage.label}</div>
              {event && (
                <div className="text-[11px] text-mute num">
                  {fmtDateTime(event.created_at)}
                  {meta?.invoice ? ` · ${meta.invoice}` : ''}
                  {meta?.po ? ` · ${meta.po}` : ''}
                  {meta?.carrier ? ` · ${meta.carrier} ${meta.tracking_number ?? ''}` : ''}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
