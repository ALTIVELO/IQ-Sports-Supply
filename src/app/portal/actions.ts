'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { requireClient } from '@/lib/auth';
import { notifyOrderPlaced } from '@/lib/notifications';

export interface PortalResult { ok: boolean; error?: string; orderNumber?: string }

/**
 * A client placing their own order. place_order() refuses any client_id but
 * their own and always uses tier pricing — a price sent from the browser is
 * never trusted.
 */
export async function placeClientOrder(
  lines: { product_id: string; qty: number }[],
): Promise<PortalResult> {
  const user = await requireClient();
  const sb = await supabaseServer();

  const clean = lines.filter((l) => l.product_id && l.qty > 0);
  if (!clean.length) return { ok: false, error: 'Your basket is empty' };

  const { data: client } = await sb
    .from('clients').select('default_location_id').eq('id', user.clientId).single();

  const { data: orderId, error } = await sb.rpc('place_order', {
    p_client_id: user.clientId,
    p_location_id: client?.default_location_id ?? null,
    p_lines: clean.map((l) => ({ product_id: l.product_id, qty: l.qty, unit_price: null })),
    p_notes: null,
  });

  if (error) return { ok: false, error: error.message };

  await notifyOrderPlaced(orderId as string);

  const { data: order } = await sb.from('orders').select('number').eq('id', orderId).single();

  revalidatePath('/portal/orders');
  revalidatePath('/portal/invoices');
  return { ok: true, orderNumber: order?.number };
}
