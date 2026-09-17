'use client';

import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { Button, Notice } from '@/components/ui';
import { signInError } from '@/lib/login/signInError';
import { passwordSignInError } from '@/lib/login/password';
import { prepareSignIn } from './actions';

/**
 * Two ways in, and the link is still the default one.
 *
 * Nobody has a password until they set one, and the link needs nothing
 * remembered — so it leads. The password is there for the people who sign in
 * every morning and would rather not go via their inbox, and for them it is
 * one click away and stays chosen for next time.
 */
export default function LoginForm({ next, initialError }: {
  next?: string; initialError?: string;
}) {
  const [mode, setMode] = useState<'link' | 'password'>('link');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<'idle' | 'working' | 'sent'>('idle');
  const [error, setError] = useState(initialError ?? '');

  function swap(to: 'link' | 'password') {
    setMode(to);
    setError('');
    setPassword('');
  }

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setState('working');
    setError('');

    const redirectTo =
      `${window.location.origin}/auth/callback` + (next ? `?next=${encodeURIComponent(next)}` : '');

    // An approved client who has never signed in has no account yet, and a
    // link for an address with no account depends on signups being open — which
    // a trade portal should not leave open. This makes the account first where
    // the address is one of ours, and does nothing at all otherwise.
    await prepareSignIn(email.trim());

    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo },
    });

    if (error) {
      setError(signInError(error));
      setState('idle');
    } else {
      setState('sent');
    }
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setState('working');
    setError('');

    const { error } = await supabaseBrowser().auth
      .signInWithPassword({ email: email.trim(), password });

    if (error) {
      setError(passwordSignInError(error));
      setState('idle');
      return;
    }

    // A whole navigation rather than a client-side push: the session cookie
    // has just been written, and the destination is decided on the server from
    // the role behind it. "/" sends each role to the app it belongs in.
    window.location.assign(next || '/');
  }

  if (state === 'sent') {
    return (
      <Notice tone="success">
        Check <strong>{email}</strong> — we have sent you a sign-in link. It is valid for one hour.
      </Notice>
    );
  }

  return (
    <form onSubmit={mode === 'link' ? sendLink : signIn} className="space-y-3">
      {error && <Notice>{error}</Notice>}

      <input
        type="email"
        required
        autoFocus
        autoComplete="email"
        placeholder="you@company.co.uk"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        aria-label="Email address"
      />

      {mode === 'password' && (
        <input
          type="password"
          required
          autoComplete="current-password"
          placeholder="Your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-label="Password"
        />
      )}

      <Button type="submit" kind="accent" className="w-full" disabled={state === 'working'}>
        {state === 'working'
          ? (mode === 'link' ? 'Sending…' : 'Signing in…')
          : (mode === 'link' ? 'Email me a sign-in link' : 'Sign in')}
      </Button>

      <p className="text-[12px] text-mute pt-1">
        {mode === 'link' ? (
          <>
            Set a password?{' '}
            <button
              type="button" onClick={() => swap('password')}
              className="text-flame-text font-semibold underline"
            >
              Sign in with it instead
            </button>
          </>
        ) : (
          <>
            Forgotten it, or never set one?{' '}
            <button
              type="button" onClick={() => swap('link')}
              className="text-flame-text font-semibold underline"
            >
              Email me a link instead
            </button>
          </>
        )}
      </p>
    </form>
  );
}
