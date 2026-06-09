/** Dump live shift_tick, shift_take_shift_break, shift_end_break, shift_admin_unlock.
 *  Confirm shift_configs.shift_break_seconds exists + default.
 */
import './loadEnv';
import { Client } from 'pg';

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();
  for (const fn of [
    'public.shift_tick(uuid)',
    'public.shift_take_shift_break(uuid)',
    'public.shift_end_break(uuid)',
    'public.shift_admin_unlock(uuid)',
  ]) {
    const { rows: [r] } = await c.query<{ d: string }>(
      `select pg_get_functiondef('${fn}'::regprocedure) as d`,
    );
    console.log('========================================');
    console.log('--- LIVE ' + fn);
    console.log('========================================');
    console.log(r.d);
    console.log('');
  }

  const { rows: cols } = await c.query<{ column_name: string; data_type: string; column_default: string | null; is_nullable: string }>(`
    select column_name, data_type, column_default, is_nullable
      from information_schema.columns
     where table_schema='public' and table_name='shift_configs'
       and column_name = 'shift_break_seconds'
  `);
  console.log('========================================');
  console.log('shift_configs.shift_break_seconds column:');
  console.log(cols);

  await c.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
