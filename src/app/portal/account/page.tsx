import { requireClient } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabase/server';
import PasswordCard from '@/components/PasswordCard';
import DetailsForm from './DetailsForm';
import AddressBook, { type Address } from './AddressBook';

export const dynamic = 'force-dynamic';

export interface ClientDetails {
  name: string;
  trading_name: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  vat_no: string | null;
  company_number: string | null;
  eori_no: string | null;
  address: string | null;
  invoicing_address: string | null;
}

/**
 * The client's own account: the details they maintain themselves and the
 * delivery addresses they can ship to.
 *
 * Pricing tier, VAT exemption and account status are shown but not editable —
 * those are ours to set, and the database refuses to let a client change them
 * whatever this page posts.
 */
export default async function AccountPage() {
  const user = await requireClient();
  const sb = await supabaseServer();

  const [{ data: client }, { data: addresses }, { data: hasPassword }] = await Promise.all([
    sb.from('clients')
      .select(`name, trading_name, contact_name, email, phone, vat_no, company_number,
               eori_no, address, invoicing_address, vat_exempt, tiers(name)`)
      .eq('id', user.clientId).single(),
    sb.from('client_addresses')
      .select('id, label, recipient, address, is_default')
      .eq('client_id', user.clientId).eq('active', true)
      .order('is_default', { ascending: false }).order('created_at'),
    sb.rpc('has_password'),
  ]);

  const tier = (client?.tiers as unknown as { name: string } | null)?.name;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Your account</h1>
        <p className="text-[13px] text-mute mt-1">
          {tier ? `${tier} pricing` : 'Trade account'}
          {client?.vat_exempt ? ' · VAT exempt' : ''}. To change your pricing tier, email us.
        </p>
      </div>

      <DetailsForm client={(client ?? {}) as ClientDetails} />
      <AddressBook addresses={(addresses ?? []) as Address[]} />
      <PasswordCard email={user.email} hasPassword={Boolean(hasPassword)} />
    </div>
  );
}
