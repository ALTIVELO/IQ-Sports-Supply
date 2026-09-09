import { requireStaff } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import { xeroConfigured } from '@/lib/xero/client';
import { emailEnabled } from '@/lib/email/send';
import { PageHeading } from '@/components/ui';
import SettingsScreen from './SettingsScreen';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  await requireStaff(['admin', 'accounts']);
  const sb = await supabaseServer();

  const [{ data: settings }, { data: connection }] = await Promise.all([
    sb.from('settings').select('*').eq('id', 1).single(),
    sb.from('xero_connection').select('tenant_id, connected_at').eq('id', 1).maybeSingle(),
  ]);

  return (
    <>
      <PageHeading sub="Numbering, VAT, who gets copied on what, and the Xero connection.">
        Settings
      </PageHeading>
      <SettingsScreen
        settings={settings as never}
        xeroConfigured={xeroConfigured()}
        xeroConnected={Boolean(connection?.tenant_id)}
        xeroConnectedAt={connection?.connected_at ?? null}
        emailEnabled={emailEnabled()}
      />
    </>
  );
}
