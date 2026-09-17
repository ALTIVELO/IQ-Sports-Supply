'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import { requireClient } from '@/lib/auth';

export interface AccountResult { ok: boolean; error?: string; message?: string }

const Details = z.object({
  name: z.string().trim().min(2, 'Company name is required').max(200),
  trading_name: z.string().trim().max(200),
  contact_name: z.string().trim().max(200),
  email: z.string().trim().email('A valid email address is required').or(z.literal('')),
  phone: z.string().trim().max(50),
  vat_no: z.string().trim().max(50),
  company_number: z.string().trim().max(50),
  eori_no: z.string().trim().max(50),
  address: z.string().trim().max(500),
  invoicing_address: z.string().trim().max(500),
});

/**
 * Saves the details a client owns.
 *
 * Goes through update_my_client_details rather than writing the row: that
 * function names the columns a client may change, so the pricing tier, VAT
 * exemption and account status stay staff-controlled no matter what is posted.
 */
export async function saveMyDetails(
  _prev: AccountResult | null,
  formData: FormData,
): Promise<AccountResult> {
  await requireClient();
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = Details.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const d = parsed.data;
  const sb = await supabaseServer();
  const { error } = await sb.rpc('update_my_client_details', {
    p_name: d.name,
    p_trading_name: d.trading_name,
    p_contact_name: d.contact_name,
    p_email: d.email,
    p_phone: d.phone,
    p_vat_no: d.vat_no,
    p_company_number: d.company_number,
    p_eori_no: d.eori_no,
    p_address: d.address,
    p_invoicing_address: d.invoicing_address,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/portal/account');
  revalidatePath('/portal', 'layout');
  return { ok: true, message: 'Your details have been saved' };
}

const Address = z.object({
  id: z.string().uuid().optional(),
  label: z.string().trim().min(1, 'Give the address a name, like "Shop" or "Warehouse"').max(80),
  recipient: z.string().trim().max(200),
  address: z.string().trim().min(5, 'The address looks too short').max(500),
  is_default: z.boolean(),
});

export async function saveMyAddress(input: unknown): Promise<AccountResult> {
  const user = await requireClient();
  const parsed = Address.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const sb = await supabaseServer();
  const { id, ...fields } = parsed.data;
  const row = {
    ...fields,
    recipient: fields.recipient || null,
    client_id: user.clientId,
  };

  // RLS confines both branches to this client's own rows.
  const { error } = id
    ? await sb.from('client_addresses').update(row).eq('id', id)
    : await sb.from('client_addresses').insert(row);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/portal/account');
  revalidatePath('/portal/basket');
  return { ok: true, message: id ? 'Address updated' : 'Address added' };
}

export async function deleteMyAddress(id: string): Promise<AccountResult> {
  await requireClient();
  const sb = await supabaseServer();

  // Kept rather than deleted: past orders point at it, and a packing list
  // should still be able to say which address it was.
  const { error } = await sb.from('client_addresses')
    .update({ active: false, is_default: false }).eq('id', id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/portal/account');
  revalidatePath('/portal/basket');
  return { ok: true, message: 'Address removed' };
}

export async function makeAddressDefault(id: string): Promise<AccountResult> {
  await requireClient();
  const sb = await supabaseServer();
  // A trigger clears the previous default, so there is always exactly one.
  const { error } = await sb.from('client_addresses').update({ is_default: true }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/portal/account');
  revalidatePath('/portal/basket');
  return { ok: true, message: 'Default delivery address updated' };
}
