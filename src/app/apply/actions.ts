'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/send';
import { applicationNotice } from '@/lib/email/templates';

const Application = z.object({
  company_name: z.string().trim().min(2, 'Company name is required').max(200),
  contact_name: z.string().trim().min(2, 'Contact name is required').max(200),
  email: z.string().trim().email('A valid email address is required').max(200),
  phone: z.string().trim().max(50).optional(),
  vat_no: z.string().trim().max(50).optional(),
  address: z.string().trim().max(500).optional(),
  business_type: z.enum(['shop', 'club', 'distributor', 'other']).optional(),
  website: z.string().trim().max(300).optional(),
  message: z.string().trim().max(2000).optional(),
});

export interface ApplyState { ok: boolean; error?: string }

/** In-memory throttle: enough to stop a naive bot loop on a single instance. */
const recent = new Map<string, number[]>();
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 3;

function rateLimited(key: string): boolean {
  const now = Date.now();
  const hits = (recent.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= MAX_PER_WINDOW) return true;
  hits.push(now);
  recent.set(key, hits);
  return false;
}

export async function submitApplication(_prev: ApplyState, formData: FormData): Promise<ApplyState> {
  // Honeypot: a real person never fills a field they cannot see.
  if ((formData.get('company_website_url') as string)?.trim()) {
    return { ok: true };
  }

  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (rateLimited(ip)) {
    return { ok: false, error: 'Too many applications from this connection. Please try again later.' };
  }

  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const parsed = Application.safeParse({
    ...raw,
    business_type: raw.business_type || undefined,
    phone: raw.phone || undefined,
    vat_no: raw.vat_no || undefined,
    address: raw.address || undefined,
    website: raw.website || undefined,
    message: raw.message || undefined,
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const db = supabaseAdmin();

  // Applications are anonymous, so this runs with the service role. It writes a
  // pending row and nothing else — no access is granted anywhere by submitting.
  const { data: created, error } = await db
    .from('account_requests')
    .insert({ ...parsed.data, status: 'pending' })
    .select('id')
    .single();

  if (error) return { ok: false, error: 'We could not record your application. Please try again.' };

  const { data: settings } = await db
    .from('settings').select('company, application_recipient').eq('id', 1).single();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
  const notice = applicationNotice({
    company: settings?.company ?? 'IQ Sports Supply Ltd',
    companyName: parsed.data.company_name,
    contactName: parsed.data.contact_name,
    email: parsed.data.email,
    phone: parsed.data.phone ?? null,
    businessType: parsed.data.business_type ?? null,
    website: parsed.data.website ?? null,
    vatNo: parsed.data.vat_no ?? null,
    address: parsed.data.address ?? null,
    message: parsed.data.message ?? null,
    reviewUrl: `${appUrl}/staff/applications`,
  });

  // Notification goes to James only.
  await sendEmail({
    kind: 'application',
    to: settings?.application_recipient ? [settings.application_recipient] : [],
    subject: notice.subject,
    body: notice.body,
  });

  void created;
  return { ok: true };
}
