import { requirePartner } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { PageHeading } from '@/components/ui';
import DispatchList, { type DispatchOrder } from './DispatchList';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'To dispatch — IQ Sports Supply' };

/**
 * Orders the brand ships themselves.
 *
 * A dispatch note and nothing more: where it goes and what goes in it. Not
 * what the customer paid, not what else was on the order, not the account
 * behind it — a brand packing one box needs the address and the contents.
 */
export default async function Dispatch({
  searchParams,
}: { searchParams: Promise<{ done?: string }> }) {
  await requirePartner();
  const { done } = await searchParams;
  const sb = await supabaseServer();

  const showShipped = done === '1';
  const { data } = await sb.rpc('partner_dropship_orders', {
    p_include_shipped: showShipped,
  });

  const orders: DispatchOrder[] = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    noticeId: String(r.notice_id),
    orderNumber: String(r.order_number),
    orderDate: String(r.order_date),
    clientName: String(r.client_name ?? ''),
    shipTo: (r.ship_to as string | null) ?? '',
    shipped: Boolean(r.shipped),
    shippedAt: (r.shipped_at as string | null) ?? null,
    carrier: (r.carrier as string | null) ?? null,
    trackingNumber: (r.tracking_number as string | null) ?? null,
    lines: ((r.lines ?? []) as { sku: string; name: string; qty: number }[]) ?? [],
  }));

  return (
    <>
      <PageHeading sub="Orders our customers placed for products you ship yourself. Mark one dispatched and we will pass the tracking on to the customer.">
        To dispatch
      </PageHeading>
      <DispatchList orders={orders} showingShipped={showShipped} />
    </>
  );
}
