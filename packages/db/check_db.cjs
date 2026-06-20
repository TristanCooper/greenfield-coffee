require('dotenv').config();
const postgres = require('postgres');
const url = process.env.DATABASE_URL;
if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
const sql = postgres(url, { max: 1, prepare: false, ssl: 'require' });
(async () => {
  try {
    const rows = await sql`SELECT tag, applied_at FROM public.__migrations ORDER BY applied_at`;
    console.log('Applied migrations:');
    rows.forEach(r => console.log('  ', r.tag, r.applied_at));
    const tables = await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
    console.log('Public tables:');
    tables.forEach(r => console.log('  ', r.tablename));
  } catch (e) {
    console.error('ERR:', e.message);
  } finally {
    await sql.end();
  }
})();
