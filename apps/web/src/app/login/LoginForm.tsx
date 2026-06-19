// apps/web/src/app/login/LoginForm.tsx
//
// Client Component: the email-entry form that triggers Supabase magic-link auth.
//
// Card 0.5.
//
// Behaviour:
//   - submit → supabase.auth.signInWithOtp({ email, emailRedirectTo: <origin>/auth/callback })
//   - Supabase emails the user a one-time link. Clicking the link lands on
//     /auth/callback, which exchanges the code for a session cookie and
//     redirects to / (or `?next=` if supplied).
//
// Why emailRedirectTo is computed from window.location.origin at click-time:
//   - During local dev the origin is http://localhost:3000.
//   - In Vercel previews it's the preview URL.
//   - In production it's the canonical https://greenfield.example.com.
//   Building the URL on the server (and shipping it to the client) means we'd
//   have to plumb the public origin through env vars — fragile. Computing it
//   on the client at the moment of submit is correct: it's always the origin
//   the user is actually using.

'use client';

import { useState, type FormEvent } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

type Status =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; email: string }
  | { kind: 'error'; message: string };

export function LoginForm() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (status.kind === 'sending') return;
    const trimmed = email.trim();
    if (!trimmed) {
      setStatus({ kind: 'error', message: 'Email is required.' });
      return;
    }
    setStatus({ kind: 'sending' });
    const supabase = getSupabaseBrowserClient();
    const redirectTo = `${window.location.origin}/auth/callback`;
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) {
      setStatus({ kind: 'error', message: error.message });
      return;
    }
    setStatus({ kind: 'sent', email: trimmed });
  }

  if (status.kind === 'sent') {
    return (
      <div
        role="status"
        style={{
          padding: '1rem',
          border: '1px solid #ccc',
          borderRadius: 8,
          background: '#f6f6f6',
        }}
      >
        <p style={{ margin: 0, fontWeight: 600 }}>Check your email.</p>
        <p style={{ margin: '0.5rem 0 0', color: '#555' }}>
          We sent a magic link to <strong>{status.email}</strong>. Click it to
          sign in.
        </p>
      </div>
    );
  }

  const disabled = status.kind === 'sending';

  return (
    <form onSubmit={onSubmit} noValidate>
      <label htmlFor="email" style={{ display: 'block', marginBottom: '0.5rem' }}>
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={disabled}
        style={{
          width: '100%',
          padding: '0.6rem 0.7rem',
          fontSize: '1rem',
          border: '1px solid #ccc',
          borderRadius: 6,
          boxSizing: 'border-box',
        }}
      />
      {status.kind === 'error' && (
        <p role="alert" style={{ color: '#b00020', margin: '0.5rem 0 0' }}>
          {status.message}
        </p>
      )}
      <button
        type="submit"
        disabled={disabled}
        style={{
          marginTop: '1rem',
          width: '100%',
          padding: '0.7rem',
          fontSize: '1rem',
          background: disabled ? '#999' : '#111',
          color: '#fff',
          border: 0,
          borderRadius: 6,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        {disabled ? 'Sending…' : 'Send magic link'}
      </button>
    </form>
  );
}
