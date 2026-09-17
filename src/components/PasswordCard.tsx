'use client';

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { Button, Card, Notice } from '@/components/ui';
import { MIN_LENGTH, setPasswordError, validatePassword } from '@/lib/login/password';

/**
 * Setting a password, for whoever is signed in.
 *
 * The same card serves customers and staff, because it is the same job: an
 * emailed link always works, and this is for people who sign in every morning
 * and would rather not go via their inbox.
 *
 * There is no "remove it" button, and that is deliberate rather than missing.
 * Supabase has no way to unset a password, and offering a button that quietly
 * failed would be worse than not having one — the link keeps working either
 * way, so having a password costs nothing.
 */
export default function PasswordCard({ email, hasPassword }: {
  email: string | null; hasPassword: boolean;
}) {
  const [set, setSet] = useState(hasPassword);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  function close() {
    setOpen(false);
    setPassword('');
    setConfirmation('');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const complaint = validatePassword(password, confirmation, email ?? '');
    if (complaint) {
      setMessage({ tone: 'error', text: complaint });
      return;
    }

    setBusy(true);
    setMessage(null);
    const { error } = await supabaseBrowser().auth.updateUser({ password });
    setBusy(false);

    if (error) {
      setMessage({ tone: 'error', text: setPasswordError(error) });
      return;
    }
    setSet(true);
    close();
    setMessage({
      tone: 'success',
      text: set
        ? 'Password changed. Use it next time you sign in.'
        : 'Password set. You can use it or an emailed link — whichever suits.',
    });
  }

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">Signing in</h2>
          <p className="text-[13px] text-mute mt-0.5 max-w-xl">
            {set
              ? 'You can sign in with your password or with an emailed link. '
                + 'Both work, so a forgotten password is never a locked door.'
              : 'You sign in with a one-time link we email you. Set a password if you '
                + 'would rather not go via your inbox every time — the link keeps '
                + 'working either way.'}
          </p>
        </div>
        {!open && (
          <Button kind="ghost" small className="ml-auto" onClick={() => { setOpen(true); setMessage(null); }}>
            {set ? 'Change password' : 'Set a password'}
          </Button>
        )}
      </div>

      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      {open && (
        <form onSubmit={submit} className="space-y-3 border-t border-line pt-3">
          {/* Off-screen rather than absent: a password manager that cannot see
              which account this is offers to save the wrong one. `hidden` would
              take it out of the tree the manager reads, which defeats the
              point — so it is only visually gone. */}
          <input
            type="email" autoComplete="username" value={email ?? ''} readOnly
            tabIndex={-1} aria-hidden className="sr-only"
          />
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="text-[12px]">
              <span className="block font-semibold mb-1">New password</span>
              <input
                type="password" autoFocus required autoComplete="new-password"
                value={password} onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label className="text-[12px]">
              <span className="block font-semibold mb-1">Type it again</span>
              <input
                type="password" required autoComplete="new-password"
                value={confirmation} onChange={(e) => setConfirmation(e.target.value)}
              />
            </label>
          </div>
          <p className="text-[12px] text-mute">
            At least {MIN_LENGTH} characters. Three or four unrelated words beat one
            clever word with symbols in it.
          </p>
          <div className="flex gap-2">
            <Button type="submit" kind="accent" small disabled={busy}>
              {busy ? 'Saving…' : set ? 'Change it' : 'Set it'}
            </Button>
            <Button kind="ghost" small onClick={close}>Cancel</Button>
          </div>
        </form>
      )}
    </Card>
  );
}
