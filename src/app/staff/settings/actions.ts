'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import { xeroDisconnect } from '@/lib/xero/client';
import type { ActionResult } from '../actions';

const emails = (v: string) =>
  v.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);

export async function saveSettings(formData: FormData): Promise<ActionResult> {
  await requireStaff(['admin', 'accounts']);
  const sb = await supabaseServer();

  const str = (k: string) => String(formData.get(k) ?? '').trim();
  const num = (k: string) => Number(formData.get(k) ?? 0);

  const { error } = await sb.from('settings').update({
    company: str('company'),
    company_address: str('company_address'),
    invoice_prefix: str('invoice_prefix'),
    next_invoice: Math.max(1, num('next_invoice')),
    next_order: Math.max(1, num('next_order')),
    next_po: Math.max(1, num('next_po')),
    vat_rate: num('vat_rate'),
    payment_days: Math.max(0, num('payment_days')),
    xero_account_code: str('xero_account_code'),
    tax_type_std: str('tax_type_std'),
    tax_type_zero: str('tax_type_zero'),
    confirmation_cc: emails(str('confirmation_cc')),
    supplier_recipient: str('supplier_recipient'),
    application_recipient: str('application_recipient'),
    email_from: str('email_from'),
  }).eq('id', 1);

  if (error) return { ok: false, error: error.message };
  revalidatePath('/staff/settings');
  return { ok: true, message: 'Settings saved' };
}

export async function disconnectXero(): Promise<ActionResult> {
  await requireStaff(['admin', 'accounts']);
  await xeroDisconnect();
  revalidatePath('/staff/settings');
  return { ok: true, message: 'Xero disconnected' };
}
