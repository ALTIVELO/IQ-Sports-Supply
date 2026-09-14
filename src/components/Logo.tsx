/**
 * The IQ Sports Supply mark, drawn as SVG so it stays sharp at every size and
 * can be recoloured by context. Geometry traced from the supplied artwork.
 *
 * The orange is fixed — it is the brand accent and does not follow the text
 * colour — while the I and Q take `currentColor`, so the glyph works on the
 * dark navigation and on white without two separate files.
 */

export const BRAND_FLAME = '#FF4A1A';

/** Just the letterforms. Inherits colour; use on any background. */
export function LogoGlyph({ className = '', title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      fill="none"
    >
      <rect x="14" y="20" width="11.5" height="60" fill="currentColor" />
      <circle cx="59" cy="47" r="22" stroke="currentColor" strokeWidth="13.5" />
      <circle cx="59" cy="47" r="6.5" fill="currentColor" />
      <line x1="75.5" y1="63.5" x2="94" y2="82" stroke={BRAND_FLAME} strokeWidth="12" />
    </svg>
  );
}

/** The app-icon lockup: white mark on the dark rounded square. */
export function LogoMark({ className = '', title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      fill="none"
    >
      <rect width="100" height="100" rx="23" fill="#121619" />
      <rect x="14" y="20" width="11.5" height="60" fill="#fff" />
      <circle cx="59" cy="47" r="22" stroke="#fff" strokeWidth="13.5" />
      <circle cx="59" cy="47" r="6.5" fill="#fff" />
      <line x1="75.5" y1="63.5" x2="94" y2="82" stroke={BRAND_FLAME} strokeWidth="12" />
    </svg>
  );
}

/**
 * Horizontal lockup: mark, the flame rule, and the name — the arrangement of
 * the supplied wordmark. `tone` picks the text colour for light or dark ground.
 */
export function Wordmark({
  className = '', tone = 'dark', size = 'md',
}: {
  className?: string;
  tone?: 'dark' | 'light';
  size?: 'sm' | 'md' | 'lg';
}) {
  const glyph = { sm: 'w-7 h-7', md: 'w-10 h-10', lg: 'w-14 h-14' }[size];
  const text = { sm: 'text-[10px]', md: 'text-[12px]', lg: 'text-[15px]' }[size];
  const rule = { sm: 'h-5', md: 'h-7', lg: 'h-10' }[size];
  const colour = tone === 'light' ? 'text-white' : 'text-ink';

  return (
    <span className={`inline-flex items-center gap-2.5 ${colour} ${className}`}>
      <LogoGlyph className={`${glyph} flex-shrink-0`} title="IQ Sports Supply" />
      <span className={`${rule} w-[3px] bg-flame flex-shrink-0`} aria-hidden />
      <span className={`${text} font-bold leading-[1.15] tracking-[0.14em] uppercase`}>
        Sports
        <br />
        Supply
      </span>
    </span>
  );
}
