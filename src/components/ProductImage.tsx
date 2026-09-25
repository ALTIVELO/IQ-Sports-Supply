'use client';

import { useEffect, useRef, useState } from 'react';
import { LogoGlyph } from './Logo';
import ImageZoom from './ImageZoom';

/**
 * A product photo, or a placeholder when there is none.
 *
 * Most of the catalogue arrives from supplier price sheets, which carry no
 * images at all, so the placeholder is the common case rather than the
 * exception — it has to look deliberate rather than broken. A URL that fails
 * to load falls back to the same placeholder, because a supplier's own image
 * URL can disappear without warning.
 *
 * Plain <img> rather than next/image: these URLs point at whatever host the
 * image happens to live on, and next/image would need every one of those hosts
 * declared in next.config.mjs ahead of time.
 */
/**
 * How many times a picture is asked for again before the placeholder wins.
 *
 * Two, at 400ms and 800ms. Enough to ride out a dropped connection or a CDN
 * hiccup; not so many that a URL which is genuinely dead keeps a spinner and a
 * connection busy on every tile of a long page.
 */
const RETRIES = 2;

export default function ProductImage({
  src, alt, className = '', sizePx = 200, placeholderScale = 'half', zoom = false,
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  sizePx?: number;
  /** How prominent the placeholder mark is. Until the catalogue has photos,
   *  most tiles show it — at full weight a grid becomes a wall of identical
   *  logos, so large surfaces use the quieter setting.
   *
   *  'none' draws nothing at all, not even the box: for a dense list where the
   *  slot exists only to keep the columns lined up, and sixty repetitions of
   *  the same mark down a narrow column would be worse than the gap. The
   *  failure handling still applies, so a URL that dies leaves a space rather
   *  than a broken-image icon. */
  placeholderScale?: 'half' | 'quiet' | 'none';
  /**
   * Whether clicking the picture opens it full size.
   *
   * Off by default, and deliberately opt-in rather than everywhere: half the
   * places this is drawn sit inside something already clickable — a
   * collection tile is a link, a search result on the order desk is the
   * button that adds the line, the staff catalogue's thumbnail is the upload
   * trigger. A button inside a button is invalid, and a picture that swallowed
   * the click would stop the thing around it working.
   *
   * So it is turned on where the click is otherwise unspoken for and where
   * somebody is actually choosing: the catalogue row, the basket line, the
   * builder's own photograph.
   */
  zoom?: boolean;
}) {
  const [open, setOpen] = useState(false);
  /*
   * A load that fails is tried again before it is given up on.
   *
   * These URLs are somebody else's CDN, reached over whatever connection the
   * customer happens to be on, and a request that comes back empty is far more
   * often a moment than a fact. Before this, one such moment was permanent:
   * onError set a flag, the flag drew the placeholder, and nothing ever asked
   * again — so a photograph that would have arrived on the next attempt was
   * gone until the page was reloaded.
   *
   * It shows up unevenly, which is what makes it hard to credit. A desktop
   * window four tiles wide asks for two or three times as many images at once
   * as a phone two tiles wide, so the same flaky minute costs a laptop several
   * pictures and a phone none — and the collections it costs are the ones
   * where every product has a photograph.
   *
   * The retry remounts the <img> rather than touching the URL: a query string
   * appended to bust a cache would also miss the CDN's, and turn one slow
   * request into two.
   */
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A different product in the same slot starts with a clean slate, or a list
  // that reuses this row hands the next product the last one's failure.
  useEffect(() => {
    setAttempt(0);
    setFailed(false);
  }, [src]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  /**
   * One failure, however it was noticed.
   *
   * Shared between the img's own onError and the check on mount below,
   * because a picture can fail in two places and only one of them is an
   * event React ever hears about.
   */
  const stumbled = () => {
    if (attempt >= RETRIES) { setFailed(true); return; }
    // Backing off rather than hammering: if the CDN is having a bad moment,
    // twenty tiles retrying at once is the wrong answer.
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAttempt((a) => a + 1), 400 * (attempt + 1));
  };

  /*
   * The failure React never hears about.
   *
   * These pages are server-rendered, so the browser has the <img> in its
   * hands and is already fetching before any of this code runs. A request
   * that fails in that window fires its error against an element React has
   * not attached a handler to yet, and React does not replay it — so onError
   * alone catches the failures that happen late and none of the ones that
   * happen first, which are most of them.
   *
   * Asking the element directly is how that gets caught: an <img> that has
   * finished (complete) with nothing to show for it (naturalWidth 0) has
   * failed, whether or not anybody was listening at the time. Checked through
   * a ref so it runs on each attempt's element, and never for one that lazy
   * loading has not started yet — those are not complete.
   */
  const check = (el: HTMLImageElement | null) => {
    if (el && el.complete && el.naturalWidth === 0) stumbled();
  };

  const showPlaceholder = !src || failed;
  const bare = placeholderScale === 'none';

  if (showPlaceholder && bare) return <div className={className} aria-hidden />;

  // Nothing to enlarge where there is no photograph, so the placeholder is
  // never a button: an affordance that opens a bigger logo is a small lie.
  const canZoom = zoom && !showPlaceholder;

  return (
    <div
      onClick={canZoom ? () => setOpen(true) : undefined}
      onKeyDown={canZoom
        ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true); } }
        : undefined}
      role={canZoom ? 'button' : undefined}
      tabIndex={canZoom ? 0 : undefined}
      aria-label={canZoom ? `Enlarge the photograph of ${alt}` : undefined}
      className={`relative overflow-hidden flex items-center justify-center ${className}
                  ${bare ? '' : 'bg-white border border-line rounded'}
                  ${canZoom ? 'cursor-zoom-in focus-visible:outline focus-visible:outline-2'
                            + ' focus-visible:outline-flame' : ''}`}
    >
      {open && src && (
        <ImageZoom src={src} alt={alt} onClose={() => setOpen(false)} />
      )}
      {showPlaceholder ? (
        <LogoGlyph
          className={placeholderScale === 'quiet'
            ? 'w-1/4 h-1/4 text-line/60'
            : 'w-1/2 h-1/2 text-line'}
        />
      ) : (
        <img
          // A new element each attempt, which is what makes the browser ask
          // again: re-setting the same src on the same element does nothing.
          key={attempt}
          ref={check}
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          width={sizePx}
          height={sizePx}
          onError={stumbled}
          className={bare ? 'max-w-full max-h-full object-contain' : 'w-full h-full object-contain'}
        />
      )}
    </div>
  );
}
