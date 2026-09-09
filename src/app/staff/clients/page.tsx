import { requireStaff } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { PageHeading } from '@/components/ui';
import ClientsScreen from './ClientsScreen';

export const dynamic = 'force-dynamic';

export default async function ClientsPage() {
  await requireStaff();
  const sb = await supabaseServer();

  const [{ data: clients }, { data: tiers }, { data: locations }] = await Promise.all([
    sb.from('clients')
      .select('id, name, tier_id, email, phone, vat_no, address, vat_exempt, default_location_id, auth_user_id, active')
      .order('name'),
    sb.from('tiers').select('id, name').order('sort'),
    sb.from('locations').select('id, name').eq('active', true).order('name'),
  ]);

  return (
    <>
      <PageHeading sub="Each client sits on one pricing tier and one default fulfilment site. The tier drives every price they see — nothing to remember at order time.">
        Clients
      </PageHeading>
      <ClientsScreen
        clients={clients ?? []} tiers={tiers ?? []} locations={locations ?? []}
      />
    </>
  );
}
