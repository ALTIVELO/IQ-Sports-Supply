'use server';

import { revalidatePath } from 'next/cache';
import { requireStaff } from '@/lib/auth';
import { pushInvoiceToXero, syncPaymentStatus } from '@/lib/xero/invoices';
import { xeroConfigured } from '@/lib/xero/client';
import type { ActionResult } from '../actions';

export async function pushToXero(invoiceIds: string[]): Promise<ActionResult> {
  await requireStaff(['admin', 'accounts']);
  if (!xeroConfigured()) {
    return { ok: false, error: 'Xero is not configured. Use the CSV export instead.' };
  }

  let pushed = 0;
  const failures: string[] = [];
  for (const id of invoiceIds) {
    const r = await pushInvoiceToXero(id);
    if (r.ok) pushed += 1;
    else failures.push(r.error ?? 'unknown error');
  }

  revalidatePath('/staff/invoices');
  if (failures.length) {
    return { ok: false, error: `${pushed} pushed, ${failures.length} failed: ${failures[0]}` };
  }
  return { ok: true, message: `${pushed} invoice${pushed === 1 ? '' : 's'} pushed to Xero` };
}

export async function pullPaymentStatus(): Promise<ActionResult> {
  await requireStaff(['admin', 'accounts']);
  if (!xeroConfigured()) return { ok: false, error: 'Xero is not configured' };

  try {
    const { checked, paid } = await syncPaymentStatus();
    revalidatePath('/staff/invoices');
    revalidatePath('/staff/packing');
    return {
      ok: true,
      message: paid.length
        ? `${paid.length} of ${checked} now paid: ${paid.join(', ')}`
        : `Checked ${checked} — no new payments`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
