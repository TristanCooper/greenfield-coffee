// apps/web/src/lib/supabase/client.ts
//
// Browser-side Supabase client.
//
// Card 0.5. Pair with `./server.ts` — same env vars, different transport.
//
// createBrowserClient wires Supabase's auth helpers to the browser's document.cookie
// automatically (via @supabase/ssr). The publishable key is safe in the browser
// because Supabase Auth + RLS enforce identity server-side; this client cannot
// read rows the user isn't entitled to even with full knowledge of the key.
//
// Use this in:
//   - Client Components (any component imported into a page via 'use client')
//   - Event handlers that call supabase.auth.* / supabase.from(...)
//
// NEVER use this in a Server Component / Route Handler — use `./server.ts` so
// the request's auth cookie is included in outbound requests.

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@greenfield/db';

let _client: ReturnType<typeof createBrowserClient<Database>> | null = null;

/**
 * Lazily-instantiated browser Supabase client.
 *
 * Memoised at module scope so React 19 Strict-Mode double-renders (and Vercel
 * preview's repeated hydration) don't spin up multiple clients — Supabase
 * recommends a single client per browser tab. The browser singleton is fine
 * here because all reads happen inside React's component tree; there are no
 * concurrent server-side renders sharing the module.
 *
 * The return type is inferred from createBrowserClient<Database> rather than
 * spelled out — @supabase/supabase-js has shifted its SupabaseClient generic
 * shape across releases (added SchemaName, PostgrestVersion, ClientOptions
 * slots) and inferring lets us track those without hand-updating annotations
 * every release.
 */
export function getSupabaseBrowserClient() {
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Supabase env missing in browser bundle: NEXT_PUBLIC_SUPABASE_URL and ' +
        'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set at build time.',
    );
  }

  _client = createBrowserClient<Database>(url, key);
  return _client;
}
