'use client';

import { useActionState, useTransition } from 'react';
import { Button, Card, Field, Notice, Tag } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import { saveSettings, disconnectXero } from './actions';
import type { Settings } from '@/lib/types';
import type { ActionResult } from '../actions';

const initial: ActionResult = { ok: false };

export default function SettingsScreen({
  settings, xeroConfigured, xeroConnected, xeroConnectedAt, emailEnabled,
}: {
  settings: Settings; xeroConfigured: boolean; xeroConnected: boolean;
  xeroConnectedAt: string | null; emailEnabled: boolean;
}) {
  const [state, action, pending] = useActionState(
    async (_p: ActionResult, fd: FormData) => saveSettings(fd),
    initial,
  );
  const [disconnecting, startDisconnect] = useTransition();

  return (
    <div className="space-y-4">
      {state.error && <Notice>{state.error}</Notice>}
      {state.ok && state.message && <Notice tone="success">{state.message}</Notice>}

      <form action={action} className="space-y-4">
        <Card className="space-y-4">
          <h2 className="text-[12px] font-semibold uppercase tracking-wide text-mute">Company</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Field label="Invoicing company">
              <input name="company" defaultValue={settings.company} />
            </Field>
            <Field label="Company address">
              <input name="company_address" defaultValue={settings.company_address} />
            </Field>
            <Field label="Email sender identity" hint="Used as the From address once Resend is configured">
              <input name="email_from" defaultValue={settings.email_from} />
            </Field>
          </div>
        </Card>

        <Card className="space-y-4">
          <h2 className="text-[12px] font-semibold uppercase tracking-wide text-mute">
            Numbering &amp; terms
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Field label="Invoice prefix">
              <input name="invoice_prefix" defaultValue={settings.invoice_prefix} />
            </Field>
            <Field label="Next invoice number" hint="Continues from the invoices already issued">
              <input name="next_invoice" type="number" min={1} defaultValue={settings.next_invoice} className="num" />
            </Field>
            <Field label="Next order number">
              <input name="next_order" type="number" min={1} defaultValue={settings.next_order} className="num" />
            </Field>
            <Field label="Next PO number">
              <input name="next_po" type="number" min={1} defaultValue={settings.next_po} className="num" />
            </Field>
            <Field label="VAT rate %">
              <input name="vat_rate" type="number" step="0.01" min={0} defaultValue={settings.vat_rate} className="num" />
            </Field>
            <Field label="Payment terms (days)">
              <input name="payment_days" type="number" min={0} defaultValue={settings.payment_days} className="num" />
            </Field>
          </div>
        </Card>

        <Card className="space-y-4">
          <h2 className="text-[12px] font-semibold uppercase tracking-wide text-mute">
            Who gets copied
          </h2>
          {!emailEnabled && (
            <Notice tone="info">
              No email provider is configured, so nothing is actually sent yet — every
              message is written to the Outbox instead, exactly as it would go out.
              Adding <code>RESEND_API_KEY</code> switches real sending on with no rebuild.
            </Notice>
          )}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Field label="Order confirmation CC" hint="Comma separated — Rohail and James">
              <input name="confirmation_cc" defaultValue={settings.confirmation_cc?.join(', ') ?? ''} />
            </Field>
            <Field label="Supplier order recipient" hint="James, to forward to the supplier">
              <input name="supplier_recipient" type="email" defaultValue={settings.supplier_recipient} />
            </Field>
            <Field label="Application notifications" hint="James only">
              <input name="application_recipient" type="email" defaultValue={settings.application_recipient} />
            </Field>
          </div>
        </Card>

        <Card className="space-y-4">
          <h2 className="text-[12px] font-semibold uppercase tracking-wide text-mute">Xero codes</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            <Field label="Account code">
              <input name="xero_account_code" defaultValue={settings.xero_account_code} className="num" />
            </Field>
            <Field label="Tax type (standard)">
              <input name="tax_type_std" defaultValue={settings.tax_type_std} />
            </Field>
            <Field label="Tax type (zero-rated)">
              <input name="tax_type_zero" defaultValue={settings.tax_type_zero} />
            </Field>
          </div>
        </Card>

        <Button type="submit" kind="cobalt" disabled={pending}>
          {pending ? 'Saving…' : 'Save settings'}
        </Button>
      </form>

      <Card className="space-y-3">
        <h2 className="text-[12px] font-semibold uppercase tracking-wide text-mute">
          Xero connection
        </h2>
        {!xeroConfigured ? (
          <Notice tone="info">
            Xero is not configured. Set <code>XERO_CLIENT_ID</code>,{' '}
            <code>XERO_CLIENT_SECRET</code> and <code>XERO_REDIRECT_URI</code> to enable
            the API push. Until then the Xero-format CSV export on the Invoices screen
            covers accounts and payments can be marked by hand.
          </Notice>
        ) : xeroConnected ? (
          <div className="flex flex-wrap items-center gap-3">
            <Tag tone="green">Connected</Tag>
            <span className="text-[12px] text-mute num">since {fmtDate(xeroConnectedAt)}</span>
            <Button
              small kind="ghost" disabled={disconnecting}
              onClick={() => startDisconnect(() => { void disconnectXero(); })}
            >
              Disconnect
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Tag tone="line">Not connected</Tag>
            <a
              href="/api/xero/connect"
              className="text-[12px] font-semibold border border-transparent bg-cobalt text-white rounded px-[10px] py-[5px] hover:bg-[#1c37a8]"
            >
              Connect to Xero
            </a>
          </div>
        )}
      </Card>
    </div>
  );
}
