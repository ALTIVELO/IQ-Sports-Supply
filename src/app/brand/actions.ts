'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { requirePartner } from '@/lib/auth';

export interface PartnerResult { ok: boolean; error?: string; message?: string }

/**
 * A partner saying a box has gone.
 *
 * Through a function rather than an update, so the check that the notice is
 * theirs happens in the database next to the data and not here, where it
 * would be one forgotten `.eq()` away from letting a brand close somebody
 * else's order.
 */
export async function markDispatched(
  noticeId: string, carrier: string, tracking: string,
): Promise<PartnerResult> {
  await requirePartner();
  const sb = await supabaseServer();

  const { error } = await sb.rpc('mark_dropship_shipped', {
    p_notice: noticeId,
    p_carrier: carrier.trim() || null,
    p_tracking: tracking.trim() || null,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/brand/dispatch');
  revalidatePath('/brand');
  return { ok: true, message: 'Marked as dispatched. Thank you.' };
}
