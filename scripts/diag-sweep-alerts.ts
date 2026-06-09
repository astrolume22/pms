/** PHASE 0: schema for notifications, type CHECK, RLS; users role; live
 *  sweep body; bio6 flag presence; pg_net + http_post signature; live
 *  shift_mark_overstay_lock_emailed + overstay_lock_email_sent_at.
 */
import './loadEnv';
import { Client } from 'pg';

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();

  console.log('=== notifications columns ===');
  const { rows: cols } = await c.query(`
    select column_name, data_type, is_nullable, column_default
      from information_schema.columns
     where table_schema='public' and table_name='notifications'
     order by ordinal_position`);
  for (const r of cols) console.log(' ', r);

  console.log('\n=== notifications CHECK constraints ===');
  const { rows: chks } = await c.query(`
    select conname, pg_get_constraintdef(c.oid) as def
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace n on n.oid = cl.relnamespace
     where n.nspname='public' and cl.relname='notifications' and c.contype='c'`);
  for (const r of chks) console.log(' ', r.conname, '→', r.def);

  console.log('\n=== notifications RLS policies ===');
  const { rows: pols } = await c.query(`
    select policyname, cmd, qual, with_check
      from pg_policies where schemaname='public' and tablename='notifications'
     order by policyname`);
  for (const p of pols) {
    console.log('  ' + p.policyname + ' (' + p.cmd + ')');
    console.log('    USING      : ' + (p.qual ?? '—'));
    console.log('    WITH CHECK : ' + (p.with_check ?? '—'));
  }

  console.log('\n=== users role column(s) ===');
  const { rows: ucols } = await c.query(`
    select column_name, data_type, is_nullable
      from information_schema.columns
     where table_schema='public' and table_name='users'
       and column_name in ('role','is_super_admin','status')
     order by column_name`);
  for (const r of ucols) console.log(' ', r);

  console.log('\n=== sample admins (recipients) ===');
  const { rows: admins } = await c.query(
    `select id, username, role, is_super_admin
       from public.users
      where status='active' and (role='admin' or is_super_admin=true)`);
  for (const r of admins) console.log(' ', r);

  console.log('\n=== shift_sessions has bio6_notified_at? ===');
  const { rows: bio6 } = await c.query(`
    select column_name from information_schema.columns
     where table_schema='public' and table_name='shift_sessions'
       and column_name='bio6_notified_at'`);
  console.log(' ', bio6.length ? 'YES — already present' : 'NO — must ADD');

  console.log('\n=== shift_sessions.overstay_lock_email_sent_at? ===');
  const { rows: olesa } = await c.query(`
    select column_name, data_type from information_schema.columns
     where table_schema='public' and table_name='shift_sessions'
       and column_name='overstay_lock_email_sent_at'`);
  for (const r of olesa) console.log(' ', r);

  console.log('\n=== shift_mark_overstay_lock_emailed RPC? ===');
  const { rows: fns } = await c.query(`
    select proname, prosecdef from pg_proc where proname='shift_mark_overstay_lock_emailed'`);
  for (const r of fns) console.log(' ', r);

  console.log('\n=== pg_net extension + http_post signature ===');
  const { rows: ext } = await c.query(`
    select extname, extversion from pg_extension where extname='pg_net'`);
  for (const r of ext) console.log(' ', r);
  const { rows: httpFns } = await c.query(`
    select proname, pg_get_function_arguments(oid) as args, pg_get_function_result(oid) as result
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='net' and proname='http_post'`);
  for (const r of httpFns) console.log('  net.http_post(' + r.args + ') returns ' + r.result);

  console.log('\n=== LIVE shift_break_sweep() ===');
  const { rows: [sweepFn] } = await c.query<{ d: string }>(
    `select pg_get_functiondef('public.shift_break_sweep()'::regprocedure) as d`);
  console.log(sweepFn.d);

  console.log('\n=== shift_events.type CHECK (so we know if events allow new types) ===');
  const { rows: evChk } = await c.query(`
    select conname, pg_get_constraintdef(c.oid) as def
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace n on n.oid = cl.relnamespace
     where n.nspname='public' and cl.relname='shift_events' and c.contype='c'`);
  for (const r of evChk) console.log(' ', r.conname, '→', r.def);

  await c.end();
}
main().catch(e => { console.error('FAILED:', e); process.exit(1); });
