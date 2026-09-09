import { requireStaff } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { PageHeading } from '@/components/ui';
import SupplierScreen from './SupplierScreen';

export const dynamic = 'force-dynamic';

export default async function SupplierPage() {
  const user = await requireStaff();
  const sb = await supabaseServer();

  const [{ data: outstanding }, { data: pos }, { data: locations }] = await Promise.all([
    // Backordered lines not yet placed with a supplier.
    sb.from('order_lines')
      .select('id, sku, name, qty, bo_qty, po_qty, orders!inner(id, number, date, clients(name))')
      .gt('bo_qty', 0)
      .order('sku'),
    sb.from('purchase_orders')
      .select('id, number, date, received, received_at, receive_location_id, locations(name), po_lines(id, sku, name, qty, so_reference, received_qty)')
      .order('date', { ascending: false })
      .order('number', { ascending: false })
      .limit(60),
    sb.from('locations').select('id, name').eq('active', true).order('name'),
  ]);

  const pending = (outstanding ?? []).filter((l) => l.bo_qty > l.po_qty);

  return (
    <>
      <PageHeading sub="What goes to the supplier is SKUs, names and quantities only — no prices of any kind, no client identity. Every line carries its order reference so arriving stock books back to the right order.">
        Supplier
      </PageHeading>
      <SupplierScreen
        pending={pending as never}
        pos={pos as never}
        locations={locations ?? []}
        defaultLocationId={user.locationIds[0] ?? locations?.[0]?.id ?? ''}
      />
    </>
  );
}
