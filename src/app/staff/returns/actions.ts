'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { requireStaff } from '@/lib/auth';
import { notifyReturnDecided, notifyReturnResolved } from '@/lib/notifications';
import type { ReturnOutcome } from '@/lib/types';
import type { ActionResult } from '../actions';

/**
 * Staff working a return.
 *
 * Each of these is a thin call onto the function that does the work, for the
 * same reason the client's side is: decide_return, receive_return and
 * resolve_return refuse anything out of order — receiving a return nobody
 * approved, crediting goods that have not arrived — and they refuse it
 * whether the caller is this screen, a script or psql.
 *
 * Email is sent afterwards and never allowed to fail the step. By the time it
 * runs the decision is committed; showing an error for work that succeeded
 * gets it done twice.
 */
async function announce(run: () => Promise<void>, what: string): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (e) {
    return `${what} (${e instanceof Error ? e.message : String(e)}). ` +
           'Tell them by hand — the return itself is recorded.';
  }
}

export async function decideReturn(input: {
  id: string; approve: boolean; note?: string;
}): Promise<ActionResult> {
  await requireStaff();
  const sb = await supabaseServer();

  const { error } = await sb.rpc('decide_return', {
    p_return: input.id,
    p_approve: input.approve,
    p_note: input.note?.trim() || null,
  });
  if (error) return { ok: false, error: error.message };

  const warning = await announce(
    () => notifyReturnDecided(input.id, input.approve),
    'The customer was not emailed',
  );

  revalidatePath('/staff/returns');
  revalidatePath('/portal/returns');
  return {
    ok: true,
    message: input.approve ? 'Approved — the customer has been told where to send it'
                           : 'Declined',
    warning,
  };
}

/**
 * Booking the parcel in.
 *
 * Says how many units went back on the shelf, because that number is the
 * whole policy in one figure: wrongly-picked goods restock, faulty ones do
 * not, and somebody standing at the counter should be able to see which
 * happened without reading the code.
 */
export async function receiveReturn(input: {
  id: string; locationId?: string;
}): Promise<ActionResult> {
  await requireStaff();
  const sb = await supabaseServer();

  const { data: restocked, error } = await sb.rpc('receive_return', {
    p_return: input.id,
    p_location: input.locationId || null,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/staff/returns');
  revalidatePath('/staff/catalogue');
  revalidatePath('/portal/returns');
  return {
    ok: true,
    message: Number(restocked) > 0
      ? `Booked in. ${restocked} unit${Number(restocked) === 1 ? '' : 's'} back on the shelf; ` +
        'anything faulty has been kept off sale.'
      : 'Booked in. Nothing went back on sale — these were faulty.',
  };
}

export async function resolveReturn(input: {
  id: string; outcome: ReturnOutcome; replacementOrderId?: string;
}): Promise<ActionResult> {
  await requireStaff();
  const sb = await supabaseServer();

  const { error } = await sb.rpc('resolve_return', {
    p_return: input.id,
    p_outcome: input.outcome,
    p_replacement_order: input.replacementOrderId || null,
  });
  if (error) return { ok: false, error: error.message };

  const warning = await announce(
    () => notifyReturnResolved(input.id),
    'The customer was not emailed',
  );

  revalidatePath('/staff/returns');
  revalidatePath('/staff/invoices');
  revalidatePath('/portal/returns');
  revalidatePath('/portal/invoices');
  return {
    ok: true,
    message: input.outcome === 'refund' ? 'Credit note raised' : 'Recorded as an exchange',
    warning,
  };
}
