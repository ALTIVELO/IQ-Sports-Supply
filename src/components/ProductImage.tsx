'use client';

import { useState } from 'react';
import { LogoGlyph } from './Logo';

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
export default function ProductImage({
  src, alt, className = '', sizePx = 200, placeholderScale = 'half',
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  sizePx?: number;
  /** How prominent the placeholder mark is. Until the catalogue has photos,
   *  most tiles show it — at full weight a grid becomes a wall of identical
   *  logos, so large surfaces use the quieter setting. */
  placeholderScale?: 'half' | 'quiet';
}) {
  const [failed, setFailed] = useState(false);
  const showPlaceholder = !src || failed;

  return (
    <div
      className={`relative bg-white border border-line rounded overflow-hidden
                  flex items-center justify-center ${className}`}
    >
      {showPlaceholder ? (
        <LogoGlyph
          className={placeholderScale === 'quiet'
            ? 'w-1/4 h-1/4 text-line/60'
            : 'w-1/2 h-1/2 text-line'}
        />
      ) : (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          width={sizePx}
          height={sizePx}
          onError={() => setFailed(true)}
          className="w-full h-full object-contain"
        />
      )}
    </div>
  );
}
