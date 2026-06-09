/** Dump live pg_get_functiondef for the three shift functions we'll rewrite. */
import './loadEnv';
import { Client } from 'pg';

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();
  for (const fn of [
    'public.shift_take_shift_break(uuid)',
    'public.shift_take_bio_break(uuid)',
    'public.shift_tick(uuid)',
  ]) {
    const { rows: [r] } = await c.query<{ d: string }>(
      `select pg_get_functiondef('${fn}'::regprocedure) as d`,
    );
    console.log('========================================');
    console.log('--- ' + fn + ' ---');
    console.log('========================================');
    console.log(r.d);
    console.log('');
  }
  await c.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
