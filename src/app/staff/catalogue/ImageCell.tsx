'use client';

import { useRef, useState, useTransition } from 'react';
import ProductImage from '@/components/ProductImage';
import { supabaseBrowser } from '@/lib/supabase/client';
import { setProductImage } from './actions';

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

/**
 * Click the thumbnail to replace a product's photo.
 *
 * The file goes straight from the browser to Supabase Storage rather than
 * through a Server Action — an image is far larger than the action body limit,
 * and routing megabytes through the server to hand them back to storage would
 * be pointless work.
 */
export default function ImageCell({
  productId, sku, imageUrl, onMessage,
}: {
  productId: string;
  sku: string;
  imageUrl: string | null;
  onMessage: (m: { tone: 'error' | 'success' | 'info'; text: string }) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  async function upload(file: File) {
    if (!ALLOWED.includes(file.type)) {
      onMessage({ tone: 'error', text: 'Images must be JPEG, PNG, WebP or AVIF' });
      return;
    }
    if (file.size > MAX_BYTES) {
      onMessage({ tone: 'error', text: 'Images must be under 5MB' });
      return;
    }

    setBusy(true);
    try {
      const sb = supabaseBrowser();
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
      // Namespaced by product and stamped, so replacing a photo never serves a
      // stale one from a cache keyed on the old URL.
      const path = `${productId}/${Date.now()}.${ext}`;

      const { error } = await sb.storage.from('product-images')
        .upload(path, file, { cacheControl: '31536000', upsert: false });
      if (error) throw error;

      const { data } = sb.storage.from('product-images').getPublicUrl(path);

      startTransition(async () => {
        const r = await setProductImage(productId, data.publicUrl);
        onMessage(r.ok
          ? { tone: 'success', text: `Image set for ${sku}` }
          : { tone: 'error', text: r.error ?? 'Could not save the image' });
      });
    } catch (e) {
      onMessage({
        tone: 'error',
        text: `Upload failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy || pending}
        title={imageUrl ? `Replace the image for ${sku}` : `Add an image for ${sku}`}
        className="block rounded hover:ring-2 hover:ring-flame disabled:opacity-50"
      >
        <ProductImage src={imageUrl} alt="" className="w-10 h-10" sizePx={80} />
      </button>
      {imageUrl && (
        <button
          type="button"
          onClick={() =>
            startTransition(async () => {
              const r = await setProductImage(productId, null);
              if (!r.ok) onMessage({ tone: 'error', text: r.error ?? 'Failed' });
            })
          }
          disabled={busy || pending}
          aria-label={`Remove the image for ${sku}`}
          className="text-mute hover:text-danger text-[14px] leading-none px-0.5"
        >
          ×
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept={ALLOWED.join(',')}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
