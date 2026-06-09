import './loadEnv';
import { Client } from 'pg';

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();
  for (const fn of [
    'public.shift_tick(uuid)',
    'public.shift_admin_unlock(uuid)',
    'public.shift_end_break(uuid)',
    'public.shift_self_period_lock(uuid)',
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
  const { rows: locked } = await c.query<{ def: string }>(`
    select pg_get_constraintdef(c.oid) as def
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace n on n.oid = cl.relnamespace
     where n.nspname='public' and cl.relname='shift_sessions'
       and c.conname = 'shift_sessions_locked_reason_check'
  `);
  console.log('========================================');
  console.log('locked_reason CHECK constraint:');
  console.log(locked[0]?.def ?? '(missing)');

  // Does shift_tick return locked_reason already?
  const { rows: [tFn] } = await c.query<{ d: string }>(
    `select pg_get_functiondef('public.shift_tick(uuid)'::regprocedure) as d`,
  );
  console.log('\nshift_tick returns locked_reason?', /'locked_reason'\s*,/.test(tFn.d));
  await c.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
