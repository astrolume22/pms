import './loadEnv';
import { Client } from 'pg';

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();

  // Live function defs for: shift_tick (period_lock_due math), the
  // period self-lock RPC, shift_admin_lock (manual), and the sweep
  // (does it lock periods or only break-overstay?).
  for (const fn of [
    'public.shift_tick(uuid)',
    'public.shift_self_period_lock(uuid)',
    'public.shift_admin_lock(uuid, text)',
    'public.shift_admin_unlock(uuid)',
    'public.shift_break_sweep()',
  ]) {
    try {
      const { rows: [r] } = await c.query<{ d: string }>(
        `select pg_get_functiondef('${fn}'::regprocedure) as d`);
      console.log('========================================');
      console.log('--- LIVE ' + fn);
      console.log('========================================');
      console.log(r.d);
      console.log('');
    } catch (e) {
      console.log('--- ' + fn + ' — not found (' + (e as Error).message + ')');
    }
  }

  // Columns relevant to period tracking.
  console.log('\n=== shift_sessions period-related columns ===');
  const { rows: cols } = await c.query(`
    select column_name, data_type, is_nullable, column_default
      from information_schema.columns
     where table_schema='public' and table_name='shift_sessions'
       and column_name in ('current_period_index','period_seconds',
                           'period_85_last_index_alerted',
                           'started_at','paused_total_seconds',
                           'current_pause_started_at','current_pause_reason',
                           'required_seconds','locked_at','locked_reason',
                           'skip_next_period_lock')
     order by column_name`);
  for (const r of cols) console.log(' ', r);

  console.log('\n=== shift_configs period-related columns ===');
  const { rows: cfgCols } = await c.query(`
    select column_name, data_type, column_default
      from information_schema.columns
     where table_schema='public' and table_name='shift_configs'
       and column_name in ('mode','shift_break_seconds','shift_break_overstay_grace_seconds')
     order by column_name`);
  for (const r of cfgCols) console.log(' ', r);

  // shift_events.type CHECK — confirm 'admin_override' is allowed.
  console.log('\n=== shift_events.type CHECK constraint ===');
  const { rows: chks } = await c.query(`
    select pg_get_constraintdef(c.oid) as def
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace n on n.oid = cl.relnamespace
     where n.nspname='public' and cl.relname='shift_events'
       and c.conname='shift_events_type_check'`);
  for (const r of chks) console.log(' ', r.def);

  await c.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
