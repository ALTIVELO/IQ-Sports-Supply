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
                  shipped, shipped_at, carrier, tracking_number, tracking_url,
                  clients(name, address), orders(number), invoice_lines(sku, name, qty)`;

  const [{ data: queue }, { data: waiting }, { data: recent }] = await Promise.all([
    // Ready to pack: paid AND the stock is physically here.
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
  ]);

  return (
    <>
      <PageHeading sub="One packing list per invoice. Nothing appears here until the invoice is paid and its stock is on the shelf.">
        Packing
      </PageHeading>
      <PackingScreen
        locations={visible}
        activeLocation={activeLocation}
        queue={(queue ?? []) as never}
        waiting={(waiting ?? []) as never}
        recent={(recent ?? []) as never}
      />
    </>
  );
}
