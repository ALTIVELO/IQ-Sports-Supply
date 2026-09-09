import { requireStaff } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { PageHeading } from '@/components/ui';
import LocationsScreen from './LocationsScreen';

export const dynamic = 'force-dynamic';

export default async function LocationsPage() {
  await requireStaff(['admin']);
  const sb = await supabaseServer();

  const [{ data: locations }, { data: profiles }, { data: assignments }, { data: stock }] =
    await Promise.all([
      sb.from('locations').select('id, name, address, active').order('name'),
      sb.from('profiles').select('id, email, full_name, role').order('email'),
      sb.from('ops_locations').select('profile_id, location_id'),
      sb.from('stock_levels').select('location_id, qty'),
    ]);

  const unitsByLocation: Record<string, number> = {};
  for (const s of stock ?? []) {
    unitsByLocation[s.location_id] = (unitsByLocation[s.location_id] ?? 0) + s.qty;
  }

  return (
    <>
      <PageHeading sub="Fulfilment sites, and which ops users work each one. An ops user's packing and receiving queues show only their site(s); admin and accounts see every site.">
        Locations
      </PageHeading>
      <LocationsScreen
        locations={locations ?? []}
        profiles={(profiles ?? []) as never}
        assignments={assignments ?? []}
        unitsByLocation={unitsByLocation}
      />
    </>
  );
}
