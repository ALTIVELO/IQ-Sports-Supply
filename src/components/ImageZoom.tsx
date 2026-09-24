'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * A product photo at the size somebody actually wants to look at it.
 *
 * Catalogue tiles are small on purpose — a trade order is read as a list, not
 * browsed as a gallery — but a wheel is bought partly on what it looks like,
 * and 56 pixels of it is not a decision anybody can make. So the picture
 * opens over the page and closes again, without leaving the list.
 *
 * The supplier's own URL is used at full size rather than a thumbnail: these
 * come from Shopify and Vision's CDN at 700px or more, and the tile was
 * shrinking them all along.
 */
export default function ImageZoom({
  src, alt, onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    /*
     * Escape closes it, and the page underneath stops scrolling.
     *
     * Without the scroll lock, a phone closing the picture lands somewhere
     * else in a list of two hundred products, because the body kept moving
     * under the overlay while it was open.
     */
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);

    /*
     * The lock goes on whichever element actually scrolls.
     *
     * Putting it on <body> alone reads as done and locks nothing: this page
     * scrolls on <html>, so the list went on moving underneath the overlay and
     * a phone closing the picture landed somewhere else in two hundred
     * products. document.scrollingElement is the one the browser is really
     * scrolling; body is held too, for the layouts where it is that instead.
     */
    const scroller = document.scrollingElement as HTMLElement | null;
    const was = [scroller, document.body]
      .filter((el): el is HTMLElement => Boolean(el))
      .map((el) => [el, el.style.overflow] as const);
    for (const [el] of was) el.style.overflow = 'hidden';

    // Focus moves into the dialog so the next Tab is inside it and the next
    // Escape is heard, rather than both going to whatever was behind.
    //
    // preventScroll, because focusing an element scrolls it into view — and
    // that scrolled the page by three hundred pixels on the way in, which is
    // the jump this lock exists to stop.
    close.current?.focus({ preventScroll: true });

    return () => {
      for (const [el, overflow] of was) el.style.overflow = overflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  /*
   * Rendered on the body rather than where it was called from.
   *
   * Every tile that can open this is `relative overflow-hidden`, and it sits
   * inside cards and grids that stack in their own ways. A fixed overlay
   * nested in all that is one `transform` on an ancestor away from being
   * clipped to a 56-pixel square — which is the bug, not a styling
   * preference. On the body it has nothing above it to be trapped by.
   */
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt || 'Product photograph'}
      /*
       * Anywhere outside the picture closes it — which on a phone is most of
       * the screen and is what people reach for first.
       *
       * The propagation has to be stopped, and that is not tidiness. This is
       * a portal: React sends its events up the component tree rather than
       * the DOM one, so a click in here arrives at the tile that opened it,
       * whose own onClick opens it again. Closed and reopened in the same
       * click looks exactly like a backdrop that does nothing.
       */
      onClick={(e) => { e.stopPropagation(); onClose(); }}
      className="fixed inset-0 z-50 bg-ink/80 flex items-center justify-center p-4"
    >
      <button
        ref={close}
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Close the photograph"
        className="absolute top-3 right-3 w-10 h-10 rounded-full bg-white/90 text-ink
                   text-[20px] leading-none hover:bg-white focus-visible:bg-white"
      >
        ×
      </button>
      {/* The picture itself does not close it: somebody looking closely will
          click on the thing they are looking at. Stopping here also keeps that
          click away from the tile, for the same reason as above. */}
      <img
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        className="max-w-full max-h-full object-contain bg-white rounded shadow-lg"
      />
    </div>,
    document.body,
  );
}
