// apps/web/src/app/login/page.tsx
//
// Magic-link sign-in page.
//
// Card 0.5. Renders a Client Component (LoginForm) that calls
// `supabase.auth.signInWithOtp`. The form is intentionally minimal — no
// password field, no third-party SSO buttons. Adding those is anti-scope
// (plan §10) until post-v1.
//
// Server-side this page is just a shell: the Server Component only renders
// the Client Component below. All browser-side Supabase calls happen via
// the browser client from '@/lib/supabase/client'.
//
// Next.js App Router note: we use 'use client' so the form can hold local
// state (email input, pending flag, error message). Server Components cannot
// use React state.

import type { Metadata } from 'next';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = {
  title: 'Sign in — Greenfield',
};

export default function LoginPage() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: '2rem',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ width: '100%', maxWidth: 380 }}>
        <h1 style={{ margin: '0 0 0.5rem' }}>Greenfield</h1>
        <p style={{ color: '#555', marginTop: 0 }}>Sign in with a magic link.</p>
        <LoginForm />
      </div>
    </main>
  );
}
