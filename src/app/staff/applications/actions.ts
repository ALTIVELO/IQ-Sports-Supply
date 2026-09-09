'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import { notifyApproved, notifyRejected } from '@/lib/notifications';
import type { ActionResult } from '../actions';

/**
 * Approval is the only path from application to access. The pricing tier and
 * default fulfilment location are chosen here, as part of approving.
 */
export async function approveApplication(input: {
  requestId: string; tierId: string; locationId: string; note?: string;
}): Promise<ActionResult> {
  await requireStaff(['admin', 'accounts']);
  const sb = await supabaseServer();

  const { data: clientId, error } = await sb.rpc('approve_account_request', {
    p_request_id: input.requestId,
    p_tier_id: input.tierId,
    p_location_id: input.locationId,
    p_note: input.note ?? null,
  });
  if (error) return { ok: false, error: error.message };

  await notifyApproved(clientId as string);

  revalidatePath('/staff/applications');
  revalidatePath('/staff/clients');
  return { ok: true, message: 'Approved — welcome email sent with their sign-in link' };
}

export async function rejectApplication(input: {
  requestId: string; note?: string; notify: boolean;
}): Promise<ActionResult> {
  const user = await requireStaff(['admin', 'accounts']);
  const sb = await supabaseServer();

  const { data: request } = await sb
    .from('account_requests').select('email, company_name, status').eq('id', input.requestId).single();
  if (!request) return { ok: false, error: 'Unknown application' };
  if (request.status !== 'pending') return { ok: false, error: 'Already reviewed' };

  const { error } = await sb.from('account_requests').update({
    status: 'rejected',
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
    review_note: input.note ?? null,
  }).eq('id', input.requestId);
  if (error) return { ok: false, error: error.message };

  if (input.notify) {
    await notifyRejected(request.email, request.company_name, input.note ?? null);
  }

  revalidatePath('/staff/applications');
  return { ok: true, message: input.notify ? 'Rejected and the applicant notified' : 'Rejected' };
}
