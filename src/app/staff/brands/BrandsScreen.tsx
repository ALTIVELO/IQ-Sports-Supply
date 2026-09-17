'use client';

import { useState, useTransition } from 'react';
import { Button, Card, Empty, Notice, Tag } from '@/components/ui';
import { invitePartner, saveBrandTerms, setDropship, setPartnerActive } from './actions';

export interface BrandRow {
  id: string; name: string;
  consignment: boolean; showsMargin: boolean;
  partners: { id: string; email: string; name: string | null;
              active: boolean; signedIn: boolean }[];
  products: { id: string; sku: string; name: string; dropship: boolean }[];
}

type Msg = { tone: 'error' | 'success' | 'info'; text: string } | null;

export default function BrandsScreen({ brands }: { brands: BrandRow[] }) {
  const [message, setMessage] = useState<Msg>(null);
  const [open, setOpen] = useState<string | null>(null);

  const withPartners = brands.filter((b) => b.partners.length);
  const rest = brands.filter((b) => !b.partners.length);

  return (
    <div className="space-y-4">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      {withPartners.map((b) => (
        <Brand key={b.id} brand={b} open={open === b.id}
               onToggle={() => setOpen(open === b.id ? null : b.id)}
               onMessage={setMessage} />
      ))}

      <Card>
        <h2 className="text-[14px] font-semibold mb-1">Brands with no partner yet</h2>
        <p className="text-[12px] text-mute mb-3">
          Every brand in the catalogue. Open one to give somebody a login for it.
        </p>
        {rest.length === 0 ? <Empty>Every brand has a partner.</Empty> : (
          <div className="space-y-2">
            {rest.map((b) => (
              <Brand key={b.id} brand={b} open={open === b.id} quiet
                     onToggle={() => setOpen(open === b.id ? null : b.id)}
                     onMessage={setMessage} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Brand({ brand, open, onToggle, onMessage, quiet = false }: {
  brand: BrandRow; open: boolean; onToggle: () => void;
  onMessage: (m: Msg) => void; quiet?: boolean;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [pending, startTransition] = useTransition();
  const dropshipping = brand.products.filter((p) => p.dropship);

  const header = (
    <button onClick={onToggle} className="flex w-full flex-wrap items-center gap-3 text-left">
      <span className="text-[14px] font-semibold">{brand.name}</span>
      {brand.consignment && <Tag tone="accent">consignment</Tag>}
      {!brand.showsMargin && <Tag tone="line">sale prices hidden</Tag>}
      <span className="text-[12px] text-mute num">
        {brand.products.length} SKU{brand.products.length === 1 ? '' : 's'}
        {dropshipping.length > 0 && <> · {dropshipping.length} drop-shipped</>}
      </span>
      <span className="text-[12px] text-mute ml-auto">
        {brand.partners.length
          ? brand.partners.map((p) => p.email).join(', ')
          : 'no partner'}
      </span>
      <span className="text-[11px] text-mute">{open ? '▾' : '▸'}</span>
    </button>
  );

  const body = open && (
    <div className="mt-3 pt-3 border-t border-row-line space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        {([['consignment', 'On consignment — we pay them as their stock sells'],
           ['showsMargin', 'Show them what the goods sold for, not only what they are owed']] as const)
          .map(([field, label]) => (
            <label key={field} className="flex items-center gap-2 text-[12px]">
              <input
                type="checkbox"
                checked={brand[field]}
                disabled={pending}
                onChange={(e) => startTransition(async () => {
                  const r = await saveBrandTerms({
                    brandId: brand.id,
                    consignment: field === 'consignment' ? e.target.checked : brand.consignment,
                    showsMargin: field === 'showsMargin' ? e.target.checked : brand.showsMargin,
                  });
                  onMessage(r.ok
                    ? { tone: 'success', text: r.message ?? 'Saved' }
                    : { tone: 'error', text: r.error ?? 'Failed' });
                })}
              />
              {label}
            </label>
          ))}
      </div>

      <div>
        <div className="text-[12px] font-semibold mb-1.5">Who can see this brand</div>
        {brand.partners.length === 0 ? (
          <p className="text-[12px] text-mute mb-2">Nobody yet.</p>
        ) : (
          <div className="space-y-1 mb-2">
            {brand.partners.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-2 text-[12px]">
                <span className="num font-semibold">{p.email}</span>
                {p.name && <span className="text-mute">{p.name}</span>}
                {p.signedIn
                  ? <Tag tone="green">signed in</Tag>
                  : <Tag tone="line">not signed in yet</Tag>}
                {!p.active && <Tag tone="red">access withdrawn</Tag>}
                <Button
                  small kind="ghost" disabled={pending}
                  onClick={() => startTransition(async () => {
                    const r = await setPartnerActive(p.id, !p.active);
                    onMessage(r.ok
                      ? { tone: 'success', text: r.message ?? 'Saved' }
                      : { tone: 'error', text: r.error ?? 'Failed' });
                  })}
                >
                  {p.active ? 'Withdraw access' : 'Restore access'}
                </Button>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <input placeholder="their@email.com" value={email}
                 onChange={(e) => setEmail(e.target.value)} className="max-w-[240px]" />
          <input placeholder="Name (optional)" value={name}
                 onChange={(e) => setName(e.target.value)} className="max-w-[180px]" />
          <Button
            small disabled={pending || !email.trim()}
            onClick={() => startTransition(async () => {
              const r = await invitePartner({ brandId: brand.id, email, name });
              onMessage(r.ok
                ? { tone: 'success', text: r.message ?? 'Invited' }
                : { tone: 'error', text: r.error ?? 'Failed' });
              if (r.ok) { setEmail(''); setName(''); }
            })}
          >
            Give them access
          </Button>
        </div>
        <p className="text-[11px] text-mute mt-1.5">
          No invitation email is sent — they sign in at the usual page with this address
          and land on their own dashboard.
        </p>
      </div>

      <DropshipPicker brand={brand} onMessage={onMessage} />
    </div>
  );

  return quiet
    ? <div className="border border-line rounded p-2.5">{header}{body}</div>
    : <Card>{header}{body}</Card>;
}

/** Which of a brand's lines they post themselves. */
function DropshipPicker({ brand, onMessage }: { brand: BrandRow; onMessage: (m: Msg) => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState('');

  const shown = brand.products.filter((p) =>
    !query.trim() || `${p.sku} ${p.name}`.toLowerCase().includes(query.trim().toLowerCase()));

  function set(dropship: boolean) {
    startTransition(async () => {
      const r = await setDropship([...picked], dropship);
      onMessage(r.ok
        ? { tone: 'success', text: r.message ?? 'Saved' }
        : { tone: 'error', text: r.error ?? 'Failed' });
      if (r.ok) setPicked(new Set());
    });
  }

  return (
    <div>
      <div className="text-[12px] font-semibold mb-1.5">What they ship themselves</div>
      <p className="text-[12px] text-mute mb-2 max-w-3xl">
        An order for one of these emails the brand and lands on their dispatch list, with
        the delivery address and the lines they ship — and nothing else from the order.
      </p>
      {brand.products.length === 0 ? (
        <p className="text-[12px] text-mute">No products under this brand yet.</p>
      ) : (
        <>
          <input placeholder="Filter…" value={query} onChange={(e) => setQuery(e.target.value)}
                 className="max-w-[240px] mb-2" />
          <div className="max-h-[220px] overflow-y-auto border border-line rounded">
            {shown.map((p) => (
              <label key={p.id}
                     className="flex items-center gap-2 px-2.5 py-1.5 text-[12px]
                                border-b border-row-line last:border-b-0 hover:bg-parch">
                <input type="checkbox" checked={picked.has(p.id)}
                       onChange={() => setPicked((s) => {
                         const next = new Set(s);
                         if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
                         return next;
                       })} />
                <span className="num font-semibold min-w-[120px]">{p.sku}</span>
                <span className="flex-1 min-w-0 truncate">{p.name}</span>
                {p.dropship && <Tag tone="accent">they ship</Tag>}
              </label>
            ))}
          </div>
          {picked.size > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              <Button small kind="accent" disabled={pending} onClick={() => set(true)}>
                They ship these {picked.size}
              </Button>
              <Button small kind="ghost" disabled={pending} onClick={() => set(false)}>
                We ship these {picked.size}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
