import { requireStaff } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { PageHeading } from '@/components/ui';
import ApplicationsScreen from './ApplicationsScreen';

export const dynamic = 'force-dynamic';

export default async function ApplicationsPage() {
  await requireStaff(['admin', 'accounts']);
  const sb = await supabaseServer();

  const [{ data: requests }, { data: tiers }, { data: locations }] = await Promise.all([
    sb.from('account_requests').select('*').order('created_at', { ascending: false }).limit(200),
    sb.from('tiers').select('id, name').order('sort'),
    sb.from('locations').select('id, name').eq('active', true).order('name'),
  ]);

  return (
    <>
      <PageHeading sub="Nothing is visible to an applicant until you approve them here — there is no auto-approval anywhere. Choose their pricing tier and default fulfilment site as part of approving.">
        Trade account applications
      </PageHeading>
      <ApplicationsScreen
        requests={(requests ?? []) as never}
        tiers={tiers ?? []}
        locations={locations ?? []}
      />
    </>
  );
}
