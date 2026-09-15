'use client';

import { useActionState } from 'react';
import { Button, Card, Field, Notice } from '@/components/ui';
import { saveMyDetails, type AccountResult } from './actions';
import type { ClientDetails } from './page';

/**
 * Company, contact and invoicing details.
 *
 * Everything here posts through update_my_client_details, which names the
 * columns a client owns — so nothing on this form can reach tier_id.
 */
export default function DetailsForm({ client }: { client: ClientDetails }) {
  const [state, action, pending] = useActionState<AccountResult | null, FormData>(
    saveMyDetails, null,
  );

  const v = (x: string | null | undefined) => x ?? '';

  return (
    <form action={action}>
      <Card className="space-y-4">
        <div>
          <h2 className="text-[17px] font-semibold">Company details</h2>
          <p className="text-[12px] text-mute mt-1">
            These appear on your invoices, so keep them current.
          </p>
        </div>

        {state?.error && <Notice>{state.error}</Notice>}
        {state?.ok && <Notice tone="success">{state.message}</Notice>}

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Company name">
            <input name="name" required maxLength={200} defaultValue={v(client.name)}
                   autoComplete="organization" />
          </Field>
          <Field label="Trading name" hint="If you trade under a different name">
            <input name="trading_name" maxLength={200} defaultValue={v(client.trading_name)} />
          </Field>
          <Field label="Contact name">
            <input name="contact_name" maxLength={200} defaultValue={v(client.contact_name)}
                   autoComplete="name" />
          </Field>
          <Field label="Email" hint="Where order confirmations and invoices are sent">
            <input name="email" type="email" maxLength={200} defaultValue={v(client.email)}
                   autoComplete="email" />
          </Field>
          <Field label="Phone">
            <input name="phone" type="tel" maxLength={50} defaultValue={v(client.phone)}
                   autoComplete="tel" />
          </Field>
          <Field label="VAT number">
            <input name="vat_no" maxLength={50} defaultValue={v(client.vat_no)} />
          </Field>
          <Field label="Company number" hint="Companies House registration number">
            <input name="company_number" maxLength={50} defaultValue={v(client.company_number)} />
          </Field>
          <Field label="EORI number" hint="If you import or export goods">
            <input name="eori_no" maxLength={50} defaultValue={v(client.eori_no)} />
          </Field>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Trading address" hint="Where your business operates from">
            <textarea name="address" rows={4} maxLength={500} defaultValue={v(client.address)} />
          </Field>
          <Field label="Legal invoicing address"
                 hint="Leave blank if it is the same as your trading address">
            <textarea name="invoicing_address" rows={4} maxLength={500}
                      defaultValue={v(client.invoicing_address)} />
          </Field>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-x-3 gap-y-2">
          <Button kind="accent" type="submit" disabled={pending}
                  className="whitespace-nowrap self-start">
            {pending ? 'Saving…' : 'Save details'}
          </Button>
          <span className="text-[11px] text-mute">
            Deliveries go to the addresses below, not to your trading address.
          </span>
        </div>
      </Card>
    </form>
  );
}
