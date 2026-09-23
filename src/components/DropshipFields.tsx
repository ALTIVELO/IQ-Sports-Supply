'use client';

/**
 * Sending an order straight to the customer's own customer.
 *
 * A shop sells a groupset on a Tuesday and would rather we posted it to the
 * buyer than to the shop. It saves a leg of carriage and a day, and it moves
 * one thing from us to them: we no longer know the address. They took it over
 * the counter or off a website, and nobody here can check it or know whether
 * anybody will be in.
 *
 * So the address is typed for this order and the terms are accepted before
 * the order can be placed. Both belong on the same card as the choice, so
 * nobody ticks the box having forgotten what it was next to.
 *
 * The control is shared between the portal and the order desk, because the
 * person on the phone is agreeing exactly the same thing on the customer's
 * behalf — and it has to be the same wording, or the record of what was
 * accepted depends on which screen it came from.
 */
import { emptyDropship, type DropshipState } from '@/lib/orders/dropship';

export { emptyDropship, dropshipReady, dropshipPayload } from '@/lib/orders/dropship';
export type { DropshipState } from '@/lib/orders/dropship';

export default function DropshipFields({
  value, onChange, terms, disabled = false,
}: {
  value: DropshipState;
  onChange: (next: DropshipState) => void;
  /** The wording, from settings, so it can change without a deploy. */
  terms: string;
  disabled?: boolean;
}) {
  const set = (patch: Partial<DropshipState>) => onChange({ ...value, ...patch });

  return (
    <div className="border-t border-row-line pt-3 mt-3 space-y-3">
      <label className="flex gap-2 items-start cursor-pointer">
        <input
          type="checkbox"
          checked={value.on}
          disabled={disabled}
          // Turning it off clears what was typed and un-ticks the acceptance.
          // A stale address left behind a hidden checkbox is how the wrong
          // parcel goes to the wrong door.
          onChange={(e) => onChange(e.target.checked
            ? { ...value, on: true }
            : { ...emptyDropship })}
          className="mt-[3px]"
        />
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold">
            Send this order direct to my customer
          </span>
          <span className="block text-[12px] text-mute">
            We post it to them rather than to you. Nothing showing what you paid
            goes in the box.
          </span>
        </span>
      </label>

      {value.on && (
        <div className="space-y-3 pl-6">
          <div>
            <label htmlFor="dropship-address"
                   className="block text-[12px] font-semibold mb-1">
              Your customer&rsquo;s name and address
            </label>
            <textarea
              id="dropship-address"
              rows={5}
              value={value.shipTo}
              disabled={disabled}
              onChange={(e) => set({ shipTo: e.target.value })}
              placeholder={'Ms A Rider\n14 Cavendish Road\nLondon\nSW12 0BQ'}
              className="w-full max-w-md leading-relaxed"
            />
            <p className="text-[11px] text-mute mt-1">
              Exactly as it should appear on the parcel, postcode included.
            </p>
          </div>

          <label className="flex gap-2 items-start cursor-pointer max-w-2xl">
            <input
              type="checkbox"
              checked={value.accepted}
              disabled={disabled}
              onChange={(e) => set({ accepted: e.target.checked })}
              className="mt-[3px]"
            />
            {/* The wording itself, not a link to it. A term nobody read is a
                term nobody agreed, and this is the one that decides who pays
                for a redelivery. */}
            <span className="text-[12px] text-mute leading-relaxed">{terms}</span>
          </label>
        </div>
      )}
    </div>
  );
}
