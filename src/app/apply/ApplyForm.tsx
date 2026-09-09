'use client';

import { useActionState } from 'react';
import { submitApplication, type ApplyState } from './actions';
import { Button, Card, Field, Notice } from '@/components/ui';

const initial: ApplyState = { ok: false };

export default function ApplyForm() {
  const [state, action, pending] = useActionState(submitApplication, initial);

  if (state.ok) {
    return (
      <Card accent>
        <h2 className="text-[17px] font-semibold">Application received</h2>
        <p className="text-[13px] text-mute mt-2 leading-relaxed">
          Thank you. We review every application by hand and will be in touch by email.
          If we open an account for you, that email will contain your sign-in link.
        </p>
      </Card>
    );
  }

  return (
    <form action={action} className="space-y-4">
      {state.error && <Notice>{state.error}</Notice>}

      {/* Honeypot — hidden from people, irresistible to bots. */}
      <div aria-hidden className="absolute left-[-9999px] w-px h-px overflow-hidden">
        <label>
          Leave this field empty
          <input type="text" name="company_website_url" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <Card className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Company name">
            <input name="company_name" required maxLength={200} />
          </Field>
          <Field label="Contact name">
            <input name="contact_name" required maxLength={200} />
          </Field>
          <Field label="Email">
            <input name="email" type="email" required maxLength={200} autoComplete="email" />
          </Field>
          <Field label="Phone">
            <input name="phone" type="tel" maxLength={50} autoComplete="tel" />
          </Field>
          <Field label="Business type">
            <select name="business_type" defaultValue="shop">
              <option value="shop">Shop</option>
              <option value="club">Club</option>
              <option value="distributor">Distributor</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="VAT number" hint="If you are VAT registered">
            <input name="vat_no" maxLength={50} />
          </Field>
        </div>

        <Field label="Website or socials">
          <input name="website" maxLength={300} placeholder="https://" />
        </Field>

        <Field label="Trading address">
          <textarea name="address" rows={3} maxLength={500} />
        </Field>

        <Field label="Anything else we should know?">
          <textarea name="message" rows={3} maxLength={2000} />
        </Field>
      </Card>

      <Button type="submit" kind="cobalt" disabled={pending}>
        {pending ? 'Sending…' : 'Submit application'}
      </Button>
    </form>
  );
}
