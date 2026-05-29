/** Apply migration 0051 + smoke-test the RPC. */
import './loadEnv';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const FILE = 'supabase/migrations/20260529_0051_board_watermark.sql';
const TESSERA = '28472783-6d7a-4de9-8834-2354f62856c5';

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();

  await c.query(readFileSync(FILE, 'utf8'));
  console.log('applied ' + FILE);

  const { rows: [r] } = await c.query<{ watermark: string }>(
    `select public.board_watermark($1::uuid) as watermark`,
    [TESSERA],
  );
  console.log('Tessera watermark = ' + r.watermark);

  // Confirm grant is in place.
  const { rows: grants } = await c.query<{ has_priv: boolean }>(
    `select has_function_privilege('authenticated', 'public.board_watermark(uuid)', 'EXECUTE') as has_priv`,
  );
  console.log('authenticated can EXECUTE board_watermark: ' + grants[0].has_priv);

  const ok = !!r.watermark && grants[0].has_priv;
  console.log(ok ? '\n✅ 0051 verified.' : '\n❌ FAIL — investigate above.');
  if (!ok) process.exit(1);

  await c.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
