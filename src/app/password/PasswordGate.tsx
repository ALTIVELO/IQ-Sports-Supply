'use client';

import { useState, useTransition } from 'react';
import { Button, Notice } from '@/components/ui';
import { MIN_LENGTH } from '@/lib/login/password';
import { replaceTemporaryPassword } from './actions';

/** Choosing the password that replaces the one somebody read out to you. */
export default function PasswordGate({ email, next }: { email: string | null; next: string }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    startTransition(async () => {
      const r = await replaceTemporaryPassword(password, confirmation);
      if (!r.ok) { setError(r.error ?? 'That could not be saved'); return; }
      // A whole navigation: the guards read the flag on the server, and this
      // page must not be the thing that decides they have been satisfied.
      window.location.assign(next);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && <Notice>{error}</Notice>}

      {/* Named, so a password manager saves it against the right account. */}
      <input
        type="email" autoComplete="username" value={email ?? ''} readOnly
        tabIndex={-1} aria-hidden className="sr-only"
      />

      <label className="text-[12px] block">
        <span className="block font-semibold mb-1">New password</span>
        <input
          type="password" autoFocus required autoComplete="new-password"
          value={password} onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <label className="text-[12px] block">
        <span className="block font-semibold mb-1">Type it again</span>
        <input
          type="password" required autoComplete="new-password"
          value={confirmation} onChange={(e) => setConfirmation(e.target.value)}
        />
      </label>

      <p className="text-[12px] text-mute">
        At least {MIN_LENGTH} characters. Three or four unrelated words beat one clever
        word with symbols in it.
      </p>

      <Button type="submit" kind="accent" className="w-full" disabled={pending}>
        {pending ? 'Saving…' : 'Set my password and carry on'}
      </Button>
    </form>
  );
}
