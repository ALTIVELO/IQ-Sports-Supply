'use server';

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireStaff } from '@/lib/auth';
import type { ActionResult } from '../actions';

/** How a brand is set up: on consignment, and what its partners may see. */
export async function saveBrandTerms(input: {
  brandId: string; consignment: boolean; showsMargin: boolean;
  agency?: boolean; agencyTerms?: string;
}): Promise<ActionResult> {
  await requireStaff(['admin', 'accounts']);
  const sb = await supabaseServer();

  const patch: Record<string, unknown> = {
    consignment: input.consignment, shows_margin: input.showsMargin,
  };
  if (input.agency !== undefined) patch.agency = input.agency;
  if (input.agencyTerms !== undefined) {
    patch.agency_terms = input.agencyTerms.trim() || null;
  }

  // Marking a brand as introduced with nothing to say is the one combination
  // that looks configured and discloses nothing, so it is refused here rather
  // than discovered on a customer's order.
  if (patch.agency === true && !(patch.agency_terms ?? input.agencyTerms)) {
    const { data: existing } = await sb.from('brands')
      .select('agency_terms').eq('id', input.brandId).single();
    if (!existing?.agency_terms) {
      return {
        ok: false,
        error: 'Write what the customer should be told before marking this brand '
             + 'as one we introduce. An order that discloses nothing is worse '
             + 'than one that is not marked at all.',
      };
    }
  }

  const { error } = await sb.from('brands').update(patch).eq('id', input.brandId);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/staff/brands');
  revalidatePath('/brand');
  revalidatePath('/portal/basket');
  return { ok: true, message: 'Saved' };
}

/**
 * Invites somebody to see one brand's sales.
 *
 * The address is the invitation: the row is created with no auth user, and
 * the first time somebody signs in with that address they are attached to it —
 * the same way a client's account is claimed. So there is no token to leak
 * and no window in which a half-made account exists.
 *
 * Their role is set now rather than on arrival, because a partner signing in
 * before we had said what they were would land in the customer portal.
 */
export async function invitePartner(input: {
  brandId: string; email: string; name: string;
}): Promise<ActionResult> {
  await requireStaff(['admin', 'accounts']);
  const email = input.email.trim().toLowerCase();
  if (!email.includes('@')) return { ok: false, error: 'That is not an email address' };

  const sb = await supabaseServer();
  const { error } = await sb.from('brand_partners').insert({
    brand_id: input.brandId, email, name: input.name.trim() || null,
  });
  if (error) {
    return {
      ok: false,
      error: error.code === '23505'
        ? 'That address is already a partner for this brand'
        : error.message,
    };
  }

  // Recorded against the address so the profile is created as a partner on
  // first sign-in. Without the service role this is skipped and an admin sets
  // the role by hand, which is why the screen says so.
  let roleSet = true;
  try {
    const admin = supabaseAdmin();
    const { data: existing } = await admin.from('profiles')
      .select('id, role').eq('email', email).maybeSingle();
    if (existing) {
      // Never demote: an address that is already staff stays staff, and
      // somebody would have to say out loud that they meant to change it.
      if (existing.role === 'client') {
        await admin.from('profiles').update({ role: 'partner' }).eq('id', existing.id);
      } else if (existing.role !== 'partner') {
        roleSet = false;
      }
    }
  } catch {
    roleSet = false;
  }

  revalidatePath('/staff/brands');
  return {
    ok: true,
    message: roleSet
      ? `${email} can now sign in and will see ${''}only this brand's sales`
      : `${email} is listed, but their account already has another role — `
        + 'an admin needs to change it on the Team screen before they can sign in as a partner',
  };
}

export async function setPartnerActive(id: string, active: boolean): Promise<ActionResult> {
  await requireStaff(['admin', 'accounts']);
  const sb = await supabaseServer();
  const { error } = await sb.from('brand_partners').update({ active }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/staff/brands');
  return { ok: true, message: active ? 'Access restored' : 'Access withdrawn' };
}

/**
 * Which of a brand's products they ship themselves.
 *
 * Set per product rather than per brand: a brand can have stock here and
 * other lines they post directly, and an order for the second kind is the
 * only one they need telling about.
 */
export async function setDropship(
  productIds: string[], dropship: boolean,
): Promise<ActionResult> {
  await requireStaff(['admin', 'accounts']);
  if (!productIds.length) return { ok: false, error: 'Nothing selected' };
  const sb = await supabaseServer();

  const { error } = await sb.from('products').update({ dropship }).in('id', productIds);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/staff/brands');
  revalidatePath('/staff/catalogue');
  return {
    ok: true,
    message: dropship
      ? `${productIds.length} product${productIds.length === 1 ? '' : 's'} will now notify `
        + 'the brand when ordered'
      : `${productIds.length} product${productIds.length === 1 ? '' : 's'} no longer notify `
        + 'the brand',
  };
}
