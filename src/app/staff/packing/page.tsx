import { requireStaff } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { PageHeading, Card, Empty } from '@/components/ui';
import PackingScreen from './PackingScreen';

export const dynamic = 'force-dynamic';

export default async function PackingPage({
  searchParams,
}: { searchParams: Promise<{ location?: string }> }) {
  const user = await requireStaff();
  const { location } = await searchParams;
  const sb = await supabaseServer();

  const { data: allLocations } = await sb
    .from('locations').select('id, name').eq('active', true).order('name');

  // An ops user only ever sees their own site(s); admin and accounts see all.
  const visible = (allLocations ?? []).filter((l) => user.locationIds.includes(l.id));
  const activeLocation = location && visible.some((l) => l.id === location)
    ? location
    : visible[0]?.id ?? null;

  if (!activeLocation) {
    return (
      <>
        <PageHeading>Packing</PageHeading>
        <Card>
          <Empty>
            You are not assigned to a fulfilment site yet. An admin can assign one
            under Locations.
          </Empty>
        </Card>
      </>
    );
  }

  const select = `id, number, type, date, paid, paid_date, ready_to_pack, packed, packed_at,
                  shipped, shipped_at, delivered, delivered_at, carrier, tracking_number, tracking_url,
                  clients(id, name, address, credit_account), orders(number, dropship, ship_to),
                  invoice_lines(sku, name, qty)`;

  const [{ data: queue }, { data: waiting }, { data: recent }, { data: balances }] =
    await Promise.all([
    /*
     * Ready to pack: the stock is here, and either the money is too or the
     * client is on terms.
     *
     * The two reads are not one, because PostgREST cannot filter on a joined
     * table's column; the credit-account ones are fetched beside the paid ones
     * and the two are merged below. Both still require ready_to_pack — terms
     * are about money, not about whether the thing is on the shelf.
     */
    sb.from('invoices').select(select)
      .eq('location_id', activeLocation).eq('superseded', false)
      .eq('paid', true).eq('ready_to_pack', true).eq('packed', false)
      .order('date'),
    // Blocked, and why.
    sb.from('invoices').select(select)
      .eq('location_id', activeLocation).eq('superseded', false)
      .eq('packed', false).or('paid.eq.false,ready_to_pack.eq.false')
      .order('date'),
    sb.from('invoices').select(select)
      .eq('location_id', activeLocation).eq('superseded', false)
      .eq('packed', true)
      .order('packed_at', { ascending: false }).limit(25),
    // What each client owes, so whoever releases goods on account can see how
    // much has already been released.
    sb.rpc('client_balances'),
  ]);

  type Row = {
    id: string; paid: boolean; ready_to_pack: boolean;
    clients: { id: string; credit_account: boolean };
  };
  const onTerms = (inv: Row) => Boolean(inv.clients?.credit_account);

  // An unpaid invoice for a client on terms is not held: it is ready, and it
  // moves across so the queue is the whole of what can go out today.
  const released = ((waiting ?? []) as unknown as Row[])
    .filter((inv) => !inv.paid && inv.ready_to_pack && onTerms(inv));
  const stillWaiting = ((waiting ?? []) as unknown as Row[])
    .filter((inv) => !released.includes(inv));
  const ready = [...((queue ?? []) as unknown as Row[]), ...released];

  type Balance = { client_id: string; currency: string; due: number; overdue: number };
  const owed: Record<string, Balance[]> = {};
  for (const b of ((balances ?? []) as Balance[])) {
    (owed[b.client_id] ??= []).push(b);
  }

  return (
    <>
      <PageHeading sub="One packing list per invoice. Nothing appears here until its stock is on the shelf and the invoice is paid — or the client is on terms, in which case what they owe is shown beside it.">
        Packing
      </PageHeading>
      <PackingScreen
        locations={visible}
        activeLocation={activeLocation}
        queue={ready as never}
        waiting={stillWaiting as never}
        recent={(recent ?? []) as never}
        owed={owed}
      />
    </>
  );
}
