'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/send';
import { applicationNotice } from '@/lib/email/templates';
import { appUrl } from '@/lib/app-url';

const Application = z.object({
  company_name: z.string().trim().min(2, 'Company name is required').max(200),
  trading_name: z.string().trim().max(200).optional(),
  contact_name: z.string().trim().min(2, 'Contact name is required').max(200),
  email: z.string().trim().email('A valid email address is required').max(200),
  phone: z.string().trim().max(50).optional(),
  vat_no: z.string().trim().max(50).optional(),
  company_number: z.string().trim().max(50).optional(),
  eori_no: z.string().trim().max(50).optional(),
  address: z.string().trim().max(500).optional(),
  invoicing_address: z.string().trim().max(500).optional(),
  business_type: z.enum(['shop', 'club', 'distributor', 'other']).optional(),
  website: z.string().trim().max(300).optional(),
  social_media: z.string().trim().max(300).optional(),
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
  // An untouched input arrives as '', which zod would accept as a present but
  // empty value; every optional field is normalised to undefined so a blank
  // stays null in the database rather than an empty string.
  const parsed = Application.safeParse({
    ...raw,
    business_type: raw.business_type || undefined,
    trading_name: raw.trading_name || undefined,
    phone: raw.phone || undefined,
    vat_no: raw.vat_no || undefined,
    company_number: raw.company_number || undefined,
    eori_no: raw.eori_no || undefined,
    address: raw.address || undefined,
    invoicing_address: raw.invoicing_address || undefined,
    website: raw.website || undefined,
    social_media: raw.social_media || undefined,
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
    .from('settings').select('company, application_recipients').eq('id', 1).single();

  const notice = applicationNotice({
    company: settings?.company ?? 'IQ Sports Supply Ltd',
    companyName: parsed.data.company_name,
    tradingName: parsed.data.trading_name ?? null,
    contactName: parsed.data.contact_name,
    email: parsed.data.email,
    phone: parsed.data.phone ?? null,
    businessType: parsed.data.business_type ?? null,
    website: parsed.data.website ?? null,
    socialMedia: parsed.data.social_media ?? null,
    vatNo: parsed.data.vat_no ?? null,
    companyNumber: parsed.data.company_number ?? null,
    eoriNo: parsed.data.eori_no ?? null,
    address: parsed.data.address ?? null,
    invoicingAddress: parsed.data.invoicing_address ?? null,
    message: parsed.data.message ?? null,
    reviewUrl: `${appUrl()}/staff/applications`,
  });

  await sendEmail({
    kind: 'application',
    to: settings?.application_recipients ?? [],
    subject: notice.subject,
    body: notice.body,
  });

  void created;
  return { ok: true };
}
