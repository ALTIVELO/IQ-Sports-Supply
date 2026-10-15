import { requireClient } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { Card, Empty, Tag } from '@/components/ui';
import { fmtDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface Parcel {
  id: string; carrier: string; tracking_number: string;
  tracking_url: string | null; seq: number;
}

/**
 * The parcels on one invoice, in the order they were sent.
 *
 * Falls back to the invoice's own three columns for anything shipped before
 * parcels were rows — those were backfilled, but a row that somehow was not
 * should still show the number the customer was given rather than nothing.
 */
const parcelsOf = (s: {
  id: string; carrier: string | null; tracking_number: string | null;
  tracking_url: string | null; shipments?: Parcel[] | null;
}): Parcel[] => {
  const rows = [...(s.shipments ?? [])].sort((a, b) => a.seq - b.seq);
  if (rows.length) return rows;
  return s.tracking_number
    ? [{
      id: s.id, carrier: s.carrier ?? 'Carrier',
      tracking_number: s.tracking_number, tracking_url: s.tracking_url, seq: 0,
    }]
    : [];
};

/** Every shipment with its carrier, tracking link and shipped date. */
export default async function Shipping() {
  const user = await requireClient();
  const sb = await supabaseServer();

  const { data: shipments } = await sb
    .from('invoices')
    .select(`id, number, shipped_at, carrier, tracking_number, tracking_url,
             orders(number), invoice_lines(sku, name, qty),
             shipments(id, carrier, tracking_number, tracking_url, seq)`)
    .eq('client_id', user.clientId)
    .eq('shipped', true)
    .eq('superseded', false)
    .order('shipped_at', { ascending: false })
    .limit(100);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Shipping</h1>
        <p className="text-[13px] text-mute mt-1">Every parcel we have sent you.</p>
      </div>

      {!shipments?.length ? (
        <Card><Empty>Nothing has shipped yet.</Empty></Card>
      ) : (
        shipments.map((s) => (
          <Card key={s.id}>
            <div className="flex flex-wrap items-center gap-3">
              <span className="num font-bold">
                {(s.orders as unknown as { number: string })?.number}
              </span>
              <span className="text-[12px] text-mute num">{s.number}</span>
              <span className="text-[12px] text-mute num">
                Shipped {fmtDate(s.shipped_at)}
              </span>
              {parcelsOf(s).length > 1 && (
                <Tag tone="line">{parcelsOf(s).length} parcels</Tag>
              )}
            </div>

            {/*
              * Every parcel, not the first one.
              *
              * An order of three wheels leaves in three boxes with three
              * numbers, and a page that showed one of them left somebody
              * tracking a carton that had arrived while wondering where the
              * rest of their order was.
              */}
            <div className="mt-2 space-y-1.5">
              {parcelsOf(s).map((p, i) => (
                <div key={p.id} className="flex flex-wrap items-center gap-2">
                  {parcelsOf(s).length > 1 && (
                    <span className="text-[12px] text-mute w-12">Box {i + 1}</span>
                  )}
                  <Tag tone="green">{p.carrier}</Tag>
                  {p.tracking_url ? (
                    <a
                      href={p.tracking_url} target="_blank" rel="noreferrer"
                      className="text-[12px] font-semibold bg-ink text-white rounded px-[10px] py-[5px]"
                    >
                      Track {p.tracking_number}
                    </a>
                  ) : (
                    <span className="num text-[12px] font-semibold">{p.tracking_number}</span>
                  )}
                </div>
              ))}
            </div>
            <div className="text-[12px] text-mute num mt-2">
              {(s.invoice_lines as { sku: string; qty: number }[])
                .map((l) => `${l.sku} ×${l.qty}`).join(' · ')}
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
