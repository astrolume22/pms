/**
 * Read-only diagnostic for the P4.6 one-shift-per-day cap.
 *
 * Dumps the live state of the four mechanisms that together enforce
 * the cap, so any future drift is easy to spot at a glance:
 *
 *   1. UNIQUE(user_id, work_date) on shift_sessions (physical floor)
 *   2. shift_get_or_create_today_session body — must return the
 *      existing row when one already exists for today's work_date
 *   3. shift_start body — must reject any status that isn't
 *      'not_started' so a completed/locked session can never be
 *      restarted self-serve
 *   4. shift_admin_rearm — must begin with is_admin() so it's the
 *      ONLY sanctioned second-run path
 *
 * Also runs two live behavior probes (inside ROLLBACKed savepoints so
 * nothing in the manager's real shift state changes):
 *
 *   • get-or-create called on a 'completed' today's row → returns the
 *     SAME row + SAME status
 *   • a planned duplicate INSERT → rejected by the UNIQUE constraint
 *
 * Pair with scripts/verify-p46-cap.ts for the full 14-assertion proof.
 */
import './loadEnv';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';

interface DbErr { message: string }

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();

  console.log('━━━ 1. UNIQUE constraint on shift_sessions ━━━');
  const { rows: u } = await c.query<{ conname: string; cols: string }>(
    `select c.conname, string_agg(a.attname, ',' order by k.ord) as cols
       from pg_constraint c
       join unnest(c.conkey) with ordinality k(attnum, ord) on true
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      where c.conrelid='public.shift_sessions'::regclass and c.contype='u'
      group by c.conname;`);
  for (const r of u) console.log(`  UQ ${r.conname}: (${r.cols})`);

  console.log('\n━━━ 2. shift_get_or_create_today_session body ━━━');
  const { rows: [gor] } = await c.query<{ def: string }>(
    `select pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='shift_get_or_create_today_session' limit 1;`);
  console.log(gor.def);

  console.log('\n━━━ 3. shift_start body ━━━');
  const { rows: [st] } = await c.query<{ def: string }>(
    `select pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='shift_start' limit 1;`);
  console.log(st.def);

  console.log('\n━━━ 4. shift_admin_rearm admin gate (first 12 lines) ━━━');
  const { rows: [rearm] } = await c.query<{ def: string }>(
    `select pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='shift_admin_rearm' limit 1;`);
  console.log(rearm.def.split('\n').slice(0, 12).join('\n'));

  // Live behavior 1: get-or-create on a 'completed' today's row
  console.log('\n━━━ 5. Live test — get-or-create when today is "completed" ━━━');
  const { rows: [mgr] } = await c.query<{ id: string; full_name: string | null }>(
    `select id, full_name from public.users where role='manager' and status='active' and is_super_admin=false order by created_at asc limit 1;`);
  if (!mgr) throw new Error('no manager');
  await c.query('BEGIN');
  try {
    await c.query(`delete from public.shift_sessions where user_id=$1 and work_date=(now() at time zone 'UTC')::date;`, [mgr.id]);
    const sid = randomUUID();
    await c.query(
      `insert into public.shift_sessions
         (id, user_id, work_date, status, mode, period_seconds, required_seconds, started_at, completed_at)
       values ($1, $2, (now() at time zone 'UTC')::date, 'completed', 'medium', 10800, 28800,
               clock_timestamp() - interval '9 hours', clock_timestamp() - interval '1 hour');`,
      [sid, mgr.id]);

    await c.query(`select set_config('request.jwt.claims', $1, true);`, [JSON.stringify({ sub: mgr.id, role: 'authenticated' })]);
    const { rows: [out] } = await c.query<{ r: { id: string; status: string } }>(
      `select to_jsonb(public.shift_get_or_create_today_session()) as r;`);
    console.log(`  get-or-create returned: id=${out.r.id.slice(0, 8)}… status=${out.r.status}`);
    console.log(`  same_id=${out.r.id === sid}   same_status=${out.r.status === 'completed'}`);

    console.log('\n  Calling shift_start() on the completed session...');
    await c.query('SAVEPOINT sp_start;');
    try {
      await c.query(`select public.shift_start();`);
      console.log('  ⚠ shift_start did NOT reject — investigate.');
    } catch (e) {
      console.log(`  shift_start REJECTED: ${(e as DbErr).message.split('\n')[0]}`);
      await c.query('ROLLBACK TO SAVEPOINT sp_start;');
    }

    const { rows: [post] } = await c.query<{ status: string; started_at: string; completed_at: string }>(
      `select status, started_at::text, completed_at::text from public.shift_sessions where id=$1;`, [sid]);
    console.log(`  post-row: status=${post.status} started_at=${post.started_at} completed_at=${post.completed_at}`);
  } finally {
    await c.query('ROLLBACK');
  }

  // Live behavior 2: UNIQUE physically blocks a second row
  console.log('\n━━━ 6. UNIQUE — physical second-row insert fails ━━━');
  await c.query('BEGIN');
  try {
    await c.query(`delete from public.shift_sessions where user_id=$1 and work_date=(now() at time zone 'UTC')::date;`, [mgr.id]);
    await c.query(
      `insert into public.shift_sessions (id, user_id, work_date, status, mode, period_seconds, required_seconds)
       values (gen_random_uuid(), $1, (now() at time zone 'UTC')::date, 'not_started', 'medium', 10800, 28800);`,
      [mgr.id]);
    await c.query('SAVEPOINT sp_dup;');
    try {
      await c.query(
        `insert into public.shift_sessions (id, user_id, work_date, status, mode, period_seconds, required_seconds)
         values (gen_random_uuid(), $1, (now() at time zone 'UTC')::date, 'not_started', 'medium', 10800, 28800);`,
        [mgr.id]);
      console.log('  ⚠ second insert SUCCEEDED — UNIQUE not enforced!');
    } catch (e) {
      console.log(`  ✓ second insert rejected: ${(e as DbErr).message.split('\n')[0]}`);
      await c.query('ROLLBACK TO SAVEPOINT sp_dup;');
    }
  } finally {
    await c.query('ROLLBACK');
  }

  await c.end();
}
main().catch((e: DbErr) => { console.error(e); process.exit(1); });
