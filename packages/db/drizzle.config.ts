// drizzle.config.ts
//
// Drizzle Kit config for @greenfield/db. Card 0.4 / plan §7.1.
//
// Migrations + scripts use DATABASE_URL_DIRECT (port 5432) to bypass pgBouncer
// transaction-mode. The Next.js runtime uses DATABASE_URL (pooler, 6543).
// See SUPABASE.md for the "why two URLs" rationale.
//
// Drizzle Kit reads .env from cwd by default. We load it explicitly so the
// operator doesn't have to `export $(cat .env | xargs)` first.
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL_DIRECT;
if (!url) {
  throw new Error(
    'DATABASE_URL_DIRECT is not set. Copy .env.example to .env and fill from ' +
      'Supabase → Settings → Database → Connection string → Direct.',
  );
}

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './src/migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
  // Verbose on errors only — defaults are too quiet when migrations fail mid-apply.
  verbose: true,
  strict: true,
});
