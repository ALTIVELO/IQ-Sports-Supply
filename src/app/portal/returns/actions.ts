'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { requireClient } from '@/lib/auth';
import { notifyReturnRaised } from '@/lib/notifications';
import type { ReturnOutcome, ReturnReason } from '@/lib/types';

export interface ReturnResult {
  ok: boolean; error?: string; number?: string;
  /** It was recorded, but the desk was not told by email. */
  warning?: string;
}

/**
 * Reporting a fault or a wrong item.
 *
 * Everything that decides whether this is allowed — whose order it is, how
 * much is left to send back, whether it has even been dispatched, and whether
 * the window is still open — is checked in request_return, not here. A rule
 * enforced in a server action is a rule that holds until somebody writes a
 * second server action.
 */
export async function requestReturn(input: {
  orderId: string;
  wanted: ReturnOutcome;
  lines: { orderLineId: string; qty: number; reason: ReturnReason; note: string }[];
}): Promise<ReturnResult> {
  await requireClient();
  const sb = await supabaseServer();

  const lines = input.lines.filter((l) => l.qty > 0);
  if (!lines.length) return { ok: false, error: 'Tell us which items are affected' };

  const { data: id, error } = await sb.rpc('request_return', {
    p_order_id: input.orderId,
    p_wanted: input.wanted,
    p_lines: lines.map((l) => ({
      order_line_id: l.orderLineId, qty: l.qty, reason: l.reason, note: l.note,
    })),
  });
  if (error) return { ok: false, error: error.message };

  const { data: row } = await sb.from('returns').select('number').eq('id', id).single();

  // The return is recorded by now. A mail server having a bad morning must not
  // make it look as though nothing was reported, or the customer reports it
  // again — and it is in the staff queue either way.
  let warning: string | undefined;
  try {
    await notifyReturnRaised(id as string);
  } catch (e) {
    warning = e instanceof Error ? e.message : String(e);
  }

  revalidatePath('/portal/returns');
  revalidatePath('/portal/history');
  return { ok: true, number: row?.number, warning };
}

/** Withdrawing one, which is only possible while nobody has looked at it. */
export async function cancelReturn(id: string): Promise<ReturnResult> {
  await requireClient();
  const sb = await supabaseServer();
  const { error } = await sb.rpc('cancel_return', { p_return: id });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/portal/returns');
  return { ok: true };
}
