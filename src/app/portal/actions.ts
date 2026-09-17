'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { requireClient } from '@/lib/auth';
import { notifyOrderPlaced } from '@/lib/notifications';
import { splitByCurrency } from '@/lib/orders/split';

export interface PortalResult {
  ok: boolean; error?: string; warning?: string;
  /**
   * The order numbers raised, in the currency order they were raised in.
   * Usually one. Two when the basket held both currencies — see below.
   */
  orders?: { number: string; currency: string }[];
}

/**
 * A client placing their own order. place_order() refuses any client_id but
 * their own and always uses tier pricing — a price sent from the browser is
 * never trusted.
 *
 * A basket holding both euro and sterling goods becomes two orders and so two
 * invoices, one per currency. The alternative — refusing the basket and asking
 * the customer to sort it out themselves — makes them do the splitting we are
 * about to do anyway, at the one moment they have decided to buy. An order and
 * an invoice can each only be in one currency, so the split has to happen
 * somewhere; it may as well happen here and silently.
 *
 * Each currency is placed on its own, so one failing leaves the other standing
 * rather than losing both. That is the right way round: a customer with one of
 * their two orders placed is told exactly which, and can retry the rest.
 */
export async function placeClientOrder(
  lines: { product_id: string; qty: number }[],
  addressId?: string | null,
): Promise<PortalResult> {
  const user = await requireClient();
  const sb = await supabaseServer();

  const clean = lines.filter((l) => l.product_id && l.qty > 0);
  if (!clean.length) return { ok: false, error: 'Your basket is empty' };

  const { data: client } = await sb
    .from('clients').select('default_location_id').eq('id', user.clientId).single();

  // Read from the database, never from the basket: the currency decides how
  // many orders are raised, so it cannot come from the browser.
  const { data: priced } = await sb
    .from('products').select('id, currency').in('id', clean.map((l) => l.product_id));
  const currencyOfProduct = new Map((priced ?? []).map((p) => [p.id, p.currency ?? 'GBP']));

  // Sterling first where there is a choice, so the order numbers come back in
  // the order the counter thinks in rather than whichever hashed first.
  const parts = splitByCurrency(clean, (id) => currencyOfProduct.get(id));

  const placed: { number: string; currency: string }[] = [];
  const warnings: string[] = [];

  for (const { currency, lines: forCurrency } of parts) {
    const { data: orderId, error } = await sb.rpc('place_order', {
      p_client_id: user.clientId,
      p_location_id: client?.default_location_id ?? null,
      p_lines: forCurrency.map((l) => ({
        product_id: l.product_id, qty: l.qty, unit_price: null,
      })),
      p_notes: null,
      // place_order checks this belongs to the ordering client and falls back to
      // their default, so an id from the browser can only ever be their own.
      p_address_id: addressId || null,
    });

    if (error) {
      // Anything already placed stands. Saying so matters more than a tidy
      // error: the customer must not re-send an order that went through.
      if (!placed.length) return { ok: false, error: error.message };
      return {
        ok: true,
        orders: placed,
        warning: `Your ${placed.map((o) => o.currency).join(' and ')} order went through. `
               + `The ${currency} part of your basket did not — ${error.message}. `
               + 'It is still in your basket, so you can try it again.',
      };
    }

    // The order is already committed. A failed confirmation email must not tell
    // the client their order did not go through, or they will place it twice.
    try {
      await notifyOrderPlaced(orderId as string);
    } catch {
      warnings.push(currency);
    }

    const { data: order } = await sb.from('orders')
      .select('number, currency').eq('id', orderId).single();
    placed.push({ number: order?.number ?? '', currency: order?.currency ?? currency });
  }

  revalidatePath('/portal/orders');
  revalidatePath('/portal/invoices');
  return {
    ok: true,
    orders: placed,
    warning: warnings.length
      ? 'Your order is placed, but we could not email your confirmation just yet. '
        + 'You can see the order and download the invoice here at any time.'
      : undefined,
  };
}
