'use client';

import { useState, useTransition } from 'react';
import { Button, Card, Money, Notice, Tag } from '@/components/ui';
import { fmtDate, today } from '@/lib/format';
import Timeline from '@/components/Timeline';
import { splitInvoice } from '../actions';
import type { OrderEvent } from '@/lib/types';

interface Line {
  id: string; sku: string; name: string; qty: number; unit_price: number;
  alloc_qty: number; bo_qty: number; po_qty: number;
}
interface Inv {
  id: string; number: string; type: 'full' | 'shipment' | 'backorder'; date: string;
  due_date: string; paid: boolean; packed: boolean; shipped: boolean;
  superseded: boolean; ready_to_pack: boolean; vat_rate: number;
}
export interface OrderData {
  id: string; number: string; date: string; status: string; notes: string | null;
  clients: { id: string; name: string };
  locations: { name: string } | null;
  order_lines: Line[];
  invoices: Inv[];
  order_events: OrderEvent[];
}

export default function OrderRow({ order }: { order: OrderData }) {
  const [open, setOpen] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [availableDate, setAvailableDate] = useState(today());
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  const backordered = order.order_lines.reduce((a, l) => a + l.bo_qty, 0);
  const total = order.order_lines.reduce((a, l) => a + l.qty * Number(l.unit_price), 0);
  const live = order.invoices.filter((i) => !i.superseded);
  const fullInvoice = live.find((i) => i.type === 'full');
  const canSplit = Boolean(fullInvoice && !fullInvoice.paid && backordered > 0);

  function doSplit() {
    setError('');
    startTransition(async () => {
      const r = await splitInvoice(order.id, availableDate);
      if (r.ok) setSplitting(false);
      else setError(r.error ?? 'Could not split the invoice');
    });
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => setOpen(!open)}
          className="num text-[14px] font-bold hover:text-cobalt"
          aria-expanded={open}
        >
          {order.number}
        </button>
        <span className="text-[13px]">{order.clients?.name}</span>
        <span className="text-[12px] text-mute num">{fmtDate(order.date)}</span>
        {order.locations && <Tag tone="line">{order.locations.name}</Tag>}
        {backordered > 0
          ? <Tag tone="red">{backordered} on back order</Tag>
          : <Tag tone="green">Fully allocated</Tag>}
        {live.map((i) => (
          <Tag key={i.id} tone={i.shipped ? 'green' : i.paid ? 'cobalt' : 'line'}>
            {i.number}
            {i.shipped ? ' shipped' : i.packed ? ' packed' : i.paid ? ' paid' : ' unpaid'}
          </Tag>
        ))}
        <span className="num ml-auto font-semibold text-[13px]">
          <Money value={total} /> <span className="text-mute font-normal">net</span>
        </span>
      </div>

      {open && (
        <div className="mt-4 grid lg:grid-cols-[1fr_240px] gap-6">
          <div className="min-w-0">
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>SKU</th><th>Item</th>
                    <th className="text-right">Ordered</th>
                    <th className="text-right">Allocated</th>
                    <th className="text-right">Back order</th>
                    <th className="text-right">With supplier</th>
                    <th className="text-right">Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {order.order_lines.map((l) => (
                    <tr key={l.id}>
                      <td className="num">{l.sku}</td>
                      <td>{l.name}</td>
                      <td className="num text-right">{l.qty}</td>
                      <td className="num text-right">{l.alloc_qty}</td>
                      <td className={`num text-right ${l.bo_qty ? 'text-danger font-semibold' : 'text-mute'}`}>
                        {l.bo_qty || '—'}
                      </td>
                      <td className="num text-right text-mute">{l.po_qty || '—'}</td>
                      <td className="num text-right"><Money value={Number(l.unit_price)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {order.notes && (
              <p className="text-[12px] text-mute mt-3">Note: {order.notes}</p>
            )}

            <div className="flex flex-wrap items-center gap-2 mt-4">
              {live.map((i) => (
                <a
                  key={i.id}
                  href={`/api/invoices/${i.id}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[12px] font-semibold border border-line rounded px-[10px] py-[5px] bg-white hover:bg-parch"
                >
                  {i.number} PDF
                </a>
              ))}
              {canSplit && !splitting && (
                <Button small kind="ghost" onClick={() => setSplitting(true)}>
                  Split into shipment + back order
                </Button>
              )}
            </div>

            {splitting && (
              <div className="mt-3 border border-cobalt rounded p-3 space-y-2">
                <p className="text-[12px] text-mute">
                  The allocated items are invoiced now; the back order is invoiced separately,
                  dated to the day the stock becomes available.
                </p>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-[12px]">
                    <span className="block font-semibold mb-1">Stock available from</span>
                    <input
                      type="date" value={availableDate}
                      onChange={(e) => setAvailableDate(e.target.value)}
                      className="w-[170px]"
                    />
                  </label>
                  <Button small kind="cobalt" onClick={doSplit} disabled={pending}>
                    {pending ? 'Splitting…' : 'Split invoice'}
                  </Button>
                  <Button small kind="ghost" onClick={() => setSplitting(false)}>Cancel</Button>
                </div>
              </div>
            )}

            {error && <div className="mt-3"><Notice>{error}</Notice></div>}
          </div>

          <div>
            <div className="text-[11px] font-semibold text-mute uppercase tracking-wide mb-2.5">
              Status
            </div>
            <Timeline events={order.order_events ?? []} />
          </div>
        </div>
      )}
    </Card>
  );
}
