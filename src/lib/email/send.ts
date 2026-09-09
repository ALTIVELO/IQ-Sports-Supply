import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';

export interface OutboundEmail {
  kind: string;
  to: string[];
  cc?: string[];
  subject: string;
  /** Plain text body. Also what is shown in the in-app outbox. */
  body: string;
  html?: string;
  attachments?: { filename: string; content: string /* base64 */ }[];
  orderId?: string;
  invoiceId?: string;
  poId?: string;
}

export const emailEnabled = () => Boolean(process.env.RESEND_API_KEY);

/**
 * Sends via Resend when RESEND_API_KEY is configured. Without it the message is
 * still recorded — status 'suppressed' — so the whole flow works before the
 * email provider exists and every message is readable in the in-app outbox.
 * Never throws: a failed send must not roll back an order that was placed.
 */
export async function sendEmail(msg: OutboundEmail): Promise<{ sent: boolean; error?: string }> {
  const to = msg.to.filter(Boolean);
  const cc = (msg.cc ?? []).filter(Boolean);
  let status: 'sent' | 'suppressed' | 'failed' = 'suppressed';
  let error: string | undefined;

  if (to.length === 0) {
    error = 'No recipient address configured';
    status = 'failed';
  } else if (emailEnabled()) {
    try {
      const from = process.env.EMAIL_FROM || 'IQ Sports Supply <orders@iqsportssupply.com>';
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to,
          cc: cc.length ? cc : undefined,
          subject: msg.subject,
          text: msg.body,
          html: msg.html,
          attachments: msg.attachments,
        }),
      });
      if (res.ok) {
        status = 'sent';
      } else {
        status = 'failed';
        error = `Resend responded ${res.status}: ${await res.text()}`;
      }
    } catch (e) {
      status = 'failed';
      error = e instanceof Error ? e.message : String(e);
    }
  }

  try {
    await supabaseAdmin().from('email_log').insert({
      kind: msg.kind,
      to_addrs: to,
      cc_addrs: cc,
      subject: msg.subject,
      body: msg.body,
      status,
      error,
      order_id: msg.orderId ?? null,
      invoice_id: msg.invoiceId ?? null,
      po_id: msg.poId ?? null,
    });
  } catch {
    // The outbox is an audit trail, not a gate on the workflow.
  }

  return { sent: status === 'sent', error };
}
