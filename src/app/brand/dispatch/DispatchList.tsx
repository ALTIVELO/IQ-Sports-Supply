'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Button, Card, Empty, Notice, Tag } from '@/components/ui';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { markDispatched } from '../actions';

export interface DispatchOrder {
  noticeId: string;
  orderNumber: string;
  orderDate: string;
  clientName: string;
  shipTo: string;
  shipped: boolean;
  shippedAt: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  lines: { sku: string; name: string; qty: number }[];
}

type Msg = { tone: 'error' | 'success' | 'info'; text: string } | null;

export default function DispatchList({
  orders, showingShipped,
}: { orders: DispatchOrder[]; showingShipped: boolean }) {
  const [message, setMessage] = useState<Msg>(null);

  return (
    <div className="space-y-4">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <div className="flex flex-wrap gap-2">
        {[['', 'Waiting to go'], ['1', 'Everything, including sent']].map(([v, label]) => (
          <Link
            key={label}
            href={v ? '/brand/dispatch?done=1' : '/brand/dispatch'}
            className={`text-[12px] font-semibold rounded px-[10px] py-[5px] border
              ${(v === '1') === showingShipped
                ? 'bg-ink text-white border-ink'
                : 'bg-white border-line hover:bg-parch'}`}
          >
            {label}
          </Link>
        ))}
      </div>

      {orders.length === 0 ? (
        <Card>
          <Empty>
            {showingShipped
              ? 'Nothing here yet.'
              : 'Nothing waiting. We will email you the moment an order comes in.'}
          </Empty>
        </Card>
      ) : (
        orders.map((o) => <Order key={o.noticeId} order={o} onMessage={setMessage} />)
      )}
    </div>
  );
}

function Order({ order, onMessage }: { order: DispatchOrder; onMessage: (m: Msg) => void }) {
  const [carrier, setCarrier] = useState(order.carrier ?? '');
  const [tracking, setTracking] = useState(order.trackingNumber ?? '');
  const [pending, startTransition] = useTransition();

  return (
    <Card className={order.shipped ? 'opacity-70' : ''}>
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="num text-[14px] font-bold">{order.orderNumber}</span>
        <span className="num text-[12px] text-mute">{fmtDate(order.orderDate)}</span>
        {order.shipped
          ? <Tag tone="green">sent {fmtDateTime(order.shippedAt)}</Tag>
          : <Tag tone="red">to dispatch</Tag>}
      </div>

      <div className="grid sm:grid-cols-[1fr_260px] gap-4 mt-3 items-start">
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr><th>SKU</th><th>Item</th><th className="text-right">Qty</th></tr>
            </thead>
            <tbody>
              {order.lines.map((l) => (
                <tr key={l.sku}>
                  <td className="num">{l.sku}</td>
                  <td>{l.name}</td>
                  <td className="num text-right font-semibold">{l.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <div className="text-[12px] font-semibold mb-1">Deliver to</div>
          <div className="text-[12px] text-mute whitespace-pre-line leading-relaxed">
            <span className="font-semibold text-ink block">{order.clientName}</span>
            {order.shipTo}
          </div>
        </div>
      </div>

      {order.shipped ? (
        (order.carrier || order.trackingNumber) && (
          <p className="text-[12px] text-mute mt-3 num">
            {[order.carrier, order.trackingNumber].filter(Boolean).join(' · ')}
          </p>
        )
      ) : (
        <div className="flex flex-wrap items-end gap-2 mt-3 pt-3 border-t border-row-line">
          <label className="text-[11px] font-semibold text-mute">
            Carrier
            <input value={carrier} onChange={(e) => setCarrier(e.target.value)}
                   placeholder="DPD" className="max-w-[140px]" />
          </label>
          <label className="text-[11px] font-semibold text-mute">
            Tracking number
            <input value={tracking} onChange={(e) => setTracking(e.target.value)}
                   className="num max-w-[200px]" />
          </label>
          <Button
            small kind="accent" disabled={pending}
            onClick={() => startTransition(async () => {
              const r = await markDispatched(order.noticeId, carrier, tracking);
              onMessage(r.ok
                ? { tone: 'success', text: r.message ?? 'Marked as dispatched' }
                : { tone: 'error', text: r.error ?? 'Could not mark that as dispatched' });
            })}
          >
            {pending ? 'Saving…' : 'Mark dispatched'}
          </Button>
          <span className="text-[11px] text-mute">
            Tracking is optional, but we pass it straight to the customer.
          </span>
        </div>
      )}
    </Card>
  );
}
