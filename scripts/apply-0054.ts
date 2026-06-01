/** Apply migration 0054 idempotently. */
import './loadEnv';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const FILE = 'supabase/migrations/20260530_0054_login_device_alerts.sql';

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query(readFileSync(FILE, 'utf8'));
  console.log('applied ' + FILE);
  await c.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
