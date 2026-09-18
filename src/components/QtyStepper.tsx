'use client';

/**
 * A quantity, with a button either side of it.
 *
 * Every screen that takes a quantity used to do it with a bare number field.
 * On a desktop that is fine; on the phone the counter is actually used on it
 * is not, because tapping one opens the whole keyboard over the form you are
 * filling in, and then you have to dismiss it to see what you were doing. A
 * trade order is mostly ones and twos, and a pair of buttons does those
 * without the keyboard appearing at all.
 *
 * The number stays typeable, because a trade order is *mostly* ones and twos:
 * twenty-four bottom brackets is a real line and nobody should tap plus
 * twenty-four times. Tapping it asks for the number pad rather than the full
 * keyboard, which is the difference between a row of digits and a QWERTY
 * layout over the thing you are editing.
 */
export default function QtyStepper({
  value, onChange, min = 0, max, label, disabled = false, className = '',
}: {
  value: number;
  onChange: (next: number) => void;
  /** The floor. Zero where a quantity of none means "take it off the order". */
  min?: number;
  max?: number;
  /** What is being counted, for somebody using a screen reader. */
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const clamp = (n: number) => {
    const floored = Math.max(min, Number.isFinite(n) ? n : min);
    return max === undefined ? floored : Math.min(max, floored);
  };

  const step = (by: number) => onChange(clamp(value + by));

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={disabled || value <= min}
        aria-label={`One fewer ${label}`}
        className="w-9 h-9 flex-shrink-0 border border-line rounded bg-white text-[16px]
                   leading-none hover:bg-parch disabled:opacity-30
                   disabled:cursor-not-allowed disabled:hover:bg-white"
      >
        −
      </button>

      <input
        type="text"
        // Numeric rather than a number input: `type="number"` brings a spinner
        // nobody can hit on a phone and a full keyboard on iOS, where this
        // asks for the digits only.
        inputMode="numeric"
        pattern="[0-9]*"
        value={value}
        disabled={disabled}
        aria-label={`How many ${label}`}
        onChange={(e) => {
          const digits = e.target.value.replace(/[^0-9]/g, '');
          // An empty box on the way to typing a number is not a zero, and
          // snapping it back to the floor mid-keystroke fights the typing.
          onChange(digits === '' ? min : clamp(Number(digits)));
        }}
        className="num w-12 h-9 text-center text-[14px] font-semibold px-0"
      />

      <button
        type="button"
        onClick={() => step(1)}
        disabled={disabled || (max !== undefined && value >= max)}
        aria-label={`One more ${label}`}
        className="w-9 h-9 flex-shrink-0 border border-line rounded bg-white text-[16px]
                   leading-none hover:bg-parch disabled:opacity-30
                   disabled:cursor-not-allowed disabled:hover:bg-white"
      >
        +
      </button>
    </div>
  );
}
