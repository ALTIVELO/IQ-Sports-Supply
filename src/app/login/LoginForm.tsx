'use client';

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { Button, Notice } from '@/components/ui';

export default function LoginForm({ next, initialError }: { next?: string; initialError?: string }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState(initialError ?? '');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('sending');
    setError('');

    const redirectTo =
      `${window.location.origin}/auth/callback` + (next ? `?next=${encodeURIComponent(next)}` : '');

    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo },
    });

    if (error) {
      setError(error.message);
      setState('idle');
    } else {
      setState('sent');
    }
  }

  if (state === 'sent') {
    return (
      <Notice tone="success">
        Check <strong>{email}</strong> — we have sent you a sign-in link. It is valid for one hour.
      </Notice>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && <Notice>{error}</Notice>}
      <input
        type="email"
        required
        autoFocus
        autoComplete="email"
        placeholder="you@company.co.uk"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Button type="submit" kind="cobalt" className="w-full" disabled={state === 'sending'}>
        {state === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
      </Button>
    </form>
  );
}
