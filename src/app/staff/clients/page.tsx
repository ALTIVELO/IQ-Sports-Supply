import { requireStaff } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { PageHeading } from '@/components/ui';
import ClientsScreen from './ClientsScreen';

export const dynamic = 'force-dynamic';

export default async function ClientsPage() {
  const staff = await requireStaff();
  const sb = await supabaseServer();

  const [{ data: clients }, { data: tiers }, { data: locations }, { data: moves }] =
    await Promise.all([
      sb.from('clients')
        .select('id, name, tier_id, email, phone, vat_no, address, vat_exempt, default_location_id, auth_user_id, active')
        .order('name'),
      sb.from('tiers').select('id, name').order('sort'),
      sb.from('locations').select('id, name').eq('active', true).order('name'),
      // Who last moved each client, and when. The first question when a price
      // looks wrong, and until now nothing on this screen answered it.
      sb.rpc('last_tier_changes'),
    ]);

  type Move = {
    client_id: string; changed_at: string; by_name: string;
    from_name: string | null; to_name: string | null;
  };
  const lastMove = Object.fromEntries(
    ((moves ?? []) as Move[]).map((m) => [m.client_id, m]),
  );

  return (
    <>
      <PageHeading sub="Each client sits on one pricing tier and one default fulfilment site. The tier drives every price they see — nothing to remember at order time.">
        Clients
      </PageHeading>
      <ClientsScreen
        clients={clients ?? []} tiers={tiers ?? []} locations={locations ?? []}
        lastMove={lastMove}
        // Ops pick and pack. They read this screen and edit what is on it;
        // what a customer pays is not theirs, here or on the form.
        mayPrice={staff.role === 'admin' || staff.role === 'accounts'}
      />
    </>
  );
}
