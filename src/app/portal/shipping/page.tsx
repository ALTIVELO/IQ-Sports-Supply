import { requireClient } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { Card, Empty, Tag } from '@/components/ui';
import { fmtDate } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** Every shipment with its carrier, tracking link and shipped date. */
export default async function Shipping() {
  const user = await requireClient();
  const sb = await supabaseServer();

  const { data: shipments } = await sb
    .from('invoices')
    .select(`id, number, shipped_at, carrier, tracking_number, tracking_url,
             orders(number), invoice_lines(sku, name, qty)`)
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
              <Tag tone="green">{s.carrier}</Tag>
              {s.tracking_url && (
                <a
                  href={s.tracking_url} target="_blank" rel="noreferrer"
                  className="ml-auto text-[12px] font-semibold bg-cobalt text-white rounded px-[10px] py-[5px]"
                >
                  Track {s.tracking_number}
                </a>
              )}
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
