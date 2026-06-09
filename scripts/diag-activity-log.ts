/** Read shift_events schema + CHECK + recent rows + RLS for admin. */
import './loadEnv';
import { Client } from 'pg';

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();

  // Columns + types
  const { rows: cols } = await c.query(`
    select column_name, data_type, is_nullable, column_default
      from information_schema.columns
     where table_schema='public' and table_name='shift_events'
     order by ordinal_position`);
  console.log('=== shift_events columns ===');
  for (const r of cols) console.log(' ', r.column_name, r.data_type, r.is_nullable, 'default=' + (r.column_default ?? '—'));

  // CHECK constraints
  const { rows: chks } = await c.query(`
    select conname, pg_get_constraintdef(c.oid) as def
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace n on n.oid = cl.relnamespace
     where n.nspname='public' and cl.relname='shift_events' and c.contype='c'`);
  console.log('\n=== shift_events CHECK constraints ===');
  for (const r of chks) console.log(' ', r.conname, '→', r.def);

  // RLS policies
  const { rows: pols } = await c.query(`
    select policyname, cmd, qual, with_check
      from pg_policies
     where schemaname='public' and tablename='shift_events'
     order by policyname`);
  console.log('\n=== shift_events RLS policies ===');
  for (const p of pols) {
    console.log('  ' + p.policyname + ' (' + p.cmd + ')');
    console.log('    USING      : ' + (p.qual ?? '—'));
    console.log('    WITH CHECK : ' + (p.with_check ?? '—'));
  }

  // Recent rows — distinct types
  const { rows: types } = await c.query(`
    select type, count(*)::int as n
      from public.shift_events
     group by type order by n desc`);
  console.log('\n=== shift_events distinct types (observed in live data) ===');
  for (const r of types) console.log('  ' + r.type + '  (n=' + r.n + ')');

  // 10 most recent rows
  const { rows: recent } = await c.query(`
    select type, by, at, meta
      from public.shift_events
     order by at desc nulls last
     limit 10`);
  console.log('\n=== 10 most recent shift_events ===');
  for (const r of recent) {
    console.log('  ' + r.at + '  ' + r.type + '  meta=' + JSON.stringify(r.meta));
  }

  // Admin RLS test: can admin SELECT another user's shift_events?
  const { rows: [admin] } = await c.query<{ id: string }>(
    `select id from public.users where role='admin' and status='active' limit 1`);
  const { rows: [mgr] } = await c.query<{ id: string }>(
    `select id from public.users where role='manager' and status='active' limit 1`);
  console.log('\n=== ADMIN RLS PROBE — can admin SELECT another user\'s shift_events? ===');
  await c.query('begin');
  try {
    await c.query(`set local role authenticated`);
    await c.query(`set local "request.jwt.claim.sub" = '${admin.id}'`);
    const { rows: [n] } = await c.query<{ n: string }>(
      `select count(*)::text as n from public.shift_events where user_id = $1`, [mgr.id]);
    console.log('  admin SELECT count for other manager → n=' + n.n);
    console.log('  RLS blocks cross-user read? ' + (n.n === '0' ? 'POSSIBLY (n=0 — could be empty data, double-check)' : 'NO (' + n.n + ' rows visible)'));
  } finally {
    await c.query('rollback');
  }
  await c.end();
}
main().catch(e => { console.error(e); process.exit(1); });
