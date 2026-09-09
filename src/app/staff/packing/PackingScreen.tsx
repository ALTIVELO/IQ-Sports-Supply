'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button, Card, Empty, Notice, Tag } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { markPacked, markShipped } from '../actions';
import type { ActionResult } from '../actions';

interface Inv {
  id: string; number: string; type: 'full' | 'shipment' | 'backorder'; date: string;
  paid: boolean; paid_date: string | null; ready_to_pack: boolean;
  packed: boolean; packed_at: string | null; shipped: boolean; shipped_at: string | null;
  carrier: string | null; tracking_number: string | null; tracking_url: string | null;
  clients: { name: string; address: string | null };
  orders: { number: string };
  invoice_lines: { sku: string; name: string; qty: number }[];
}
interface Named { id: string; name: string }

export default function PackingScreen({
  locations, activeLocation, queue, waiting, recent,
}: {
  locations: Named[]; activeLocation: string;
  queue: Inv[]; waiting: Inv[]; recent: Inv[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState<{ tone: 'error' | 'success' | 'info'; text: string } | null>(null);

  return (
    <div className="space-y-5">
      {locations.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-semibold">Site</span>
          <select
            className="max-w-[200px]" value={activeLocation}
            onChange={(e) => router.push(`/staff/packing?location=${e.target.value}`)}
          >
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      )}

      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <section>
        <h2 className="text-[12px] font-semibold text-mute uppercase tracking-wide mb-2">
          Ready to pack ({queue.length})
        </h2>
        {queue.length === 0 ? (
          <Card><Empty>Nothing waiting to pack at this site.</Empty></Card>
        ) : (
          <div className="space-y-2.5">
            {queue.map((inv) => (
              <PackRow key={inv.id} inv={inv} onMessage={setMessage} />
            ))}
          </div>
        )}
      </section>

      {waiting.length > 0 && (
        <section>
          <h2 className="text-[12px] font-semibold text-mute uppercase tracking-wide mb-2">
            Held ({waiting.length})
          </h2>
          <div className="space-y-2.5">
            {waiting.map((inv) => (
              <Card key={inv.id}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="num font-bold">{inv.number}</span>
                  <span className="text-[13px]">{inv.clients.name}</span>
                  <span className="text-[12px] text-mute num">{inv.orders.number}</span>
                  {!inv.paid && <Tag tone="red">Awaiting payment</Tag>}
                  {inv.paid && !inv.ready_to_pack && <Tag tone="amber">Awaiting stock</Tag>}
                  <a
                    href={`/api/invoices/${inv.id}/pdf`} target="_blank" rel="noreferrer"
                    className="ml-auto text-[12px] font-semibold border border-line rounded px-[10px] py-[5px] bg-white hover:bg-parch"
                  >
                    Invoice
                  </a>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section>
          <h2 className="text-[12px] font-semibold text-mute uppercase tracking-wide mb-2">
            Packed
          </h2>
          <div className="space-y-2.5">
            {recent.map((inv) => (
              <PackRow key={inv.id} inv={inv} onMessage={setMessage} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function PackRow({
  inv, onMessage,
}: { inv: Inv; onMessage: (m: { tone: 'error' | 'success' | 'info'; text: string }) => void }) {
  const [shipping, setShipping] = useState(false);
  const [carrier, setCarrier] = useState(inv.carrier ?? '');
  const [tracking, setTracking] = useState(inv.tracking_number ?? '');
  const [pending, startTransition] = useTransition();

  const units = inv.invoice_lines.reduce((a, l) => a + l.qty, 0);

  const run = (fn: () => Promise<ActionResult>) =>
    startTransition(async () => {
      const r = await fn();
      onMessage(r.ok
        ? { tone: r.warning ? 'info' : 'success', text: r.warning ?? r.message ?? 'Done' }
        : { tone: 'error', text: r.error ?? 'Something went wrong' });
      if (r.ok) setShipping(false);
    });

  return (
    <Card accent={shipping}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="num font-bold">{inv.number}</span>
        <span className="text-[13px]">{inv.clients.name}</span>
        <span className="text-[12px] text-mute num">{inv.orders.number}</span>
        {inv.type !== 'full' && <Tag tone={inv.type === 'backorder' ? 'red' : 'line'}>{inv.type}</Tag>}
        <span className="text-[12px] text-mute num">{units} units · {fmtDate(inv.date)}</span>
        {inv.shipped && <Tag tone="green">Shipped</Tag>}

        <div className="ml-auto flex flex-wrap gap-1.5">
          <a
            href={`/api/invoices/${inv.id}/packing-list`} target="_blank" rel="noreferrer"
            className="text-[12px] font-semibold border border-line rounded px-[10px] py-[5px] bg-white hover:bg-parch"
          >
            Packing list
          </a>
          {!inv.packed && (
            <Button small onClick={() => run(() => markPacked(inv.id))} disabled={pending}>
              Mark packed
            </Button>
          )}
          {inv.packed && !inv.shipped && (
            <Button small kind="cobalt" onClick={() => setShipping(!shipping)}>
              {shipping ? 'Cancel' : 'Mark shipped'}
            </Button>
          )}
        </div>
      </div>

      {inv.shipped && inv.tracking_url && (
        <p className="text-[12px] text-mute mt-2 num">
          {inv.carrier} · {inv.tracking_number} ·{' '}
          <a href={inv.tracking_url} target="_blank" rel="noreferrer" className="text-cobalt font-semibold">
            Track
          </a>
        </p>
      )}

      {shipping && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-[12px]">
            <span className="block font-semibold mb-1">Carrier</span>
            <input
              className="w-[150px]" value={carrier} placeholder="DPD"
              onChange={(e) => setCarrier(e.target.value)}
            />
          </label>
          <label className="text-[12px]">
            <span className="block font-semibold mb-1">Tracking number</span>
            <input
              className="w-[200px] num" value={tracking}
              onChange={(e) => setTracking(e.target.value)}
            />
          </label>
          <Button
            small kind="cobalt" disabled={pending || !carrier.trim() || !tracking.trim()}
            onClick={() => run(() => markShipped({ invoiceId: inv.id, carrier, tracking }))}
          >
            {pending ? 'Sending…' : 'Ship & notify client'}
          </Button>
        </div>
      )}
    </Card>
  );
}
