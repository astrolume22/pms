/**
 * Apply 0067 (break limits) and prove via SQL the new semantics.
 *
 *   (a) shift_take_shift_break twice → first succeeds (status=on_shift_break,
 *       shift_break_count_today=1); after we flip back to active, second
 *       call returns blocked:true / reason:shift_break_used_today; no
 *       second shift_break_start event is created.
 *   (b) bio break at the hard limit → shift_take_bio_break returns
 *       limit_reached:true and NO bio_break_requests row is created.
 *
 * All inside a transaction that ROLLS BACK so the prod data stays put.
 * The CREATE OR REPLACE etc. is APPLIED to live (it runs BEFORE the txn).
 */
import './loadEnv';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const FILE = 'supabase/migrations/20260609_0067_break_limits.sql';

interface Resp { [k: string]: unknown }

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();

  console.log('========== APPLY ' + FILE + ' ==========');
  await c.query(readFileSync(FILE, 'utf8'));
  console.log('applied.');

  // Confirm the column landed.
  const { rows: [col] } = await c.query<{ exists: boolean }>(`
    select exists(
      select 1 from information_schema.columns
       where table_schema='public' and table_name='shift_sessions'
         and column_name='shift_break_count_today'
    ) as exists
  `);
  console.log('shift_sessions.shift_break_count_today exists?', col.exists);
  if (!col.exists) { console.error('FAIL — column missing'); process.exit(1); }

  // Confirm the recreated function bodies mention the new behavior.
  const { rows: [stb] } = await c.query<{ d: string }>(
    `select pg_get_functiondef('public.shift_take_shift_break(uuid)'::regprocedure) as d`,
  );
  const stbHasOnce = /shift_break_count_today\s*>=\s*1/i.test(stb.d) && /shift_break_used_today/i.test(stb.d);
  console.log('shift_take_shift_break has once-per-day guard? ' + stbHasOnce);
  if (!stbHasOnce) { console.error('FAIL'); process.exit(1); }

  const { rows: [tbb] } = await c.query<{ d: string }>(
    `select pg_get_functiondef('public.shift_take_bio_break(uuid)'::regprocedure) as d`,
  );
  const tbbHasHard = /limit_reached/i.test(tbb.d) && !/admin_grants/i.test(tbb.d.replace(/--.*$/gm, ''));
  console.log('shift_take_bio_break has hard limit_reached (no admin_grants)? ' + tbbHasHard);
  if (!tbbHasHard) { console.error('FAIL'); process.exit(1); }

  const { rows: [tickFn] } = await c.query<{ d: string }>(
    `select pg_get_functiondef('public.shift_tick(uuid)'::regprocedure) as d`,
  );
  const tickHasNew = /shift_break_used_today/i.test(tickFn.d) && /shift_break_count_today/i.test(tickFn.d);
  console.log('shift_tick returns new fields? ' + tickHasNew);
  if (!tickHasNew) { console.error('FAIL'); process.exit(1); }

  // ---------- ROLLBACK SIMULATION ----------
  const { rows: [admin] } = await c.query<{ id: string; username: string }>(
    `select id, username from public.users where role='admin' and status='active' limit 1`,
  );
  const { rows: [mgr] } = await c.query<{ id: string; username: string }>(
    `select id, username from public.users
       where role='manager' and status='active' and is_super_admin=false limit 1`,
  );
  if (!admin || !mgr) { console.error('FAIL — admin/mgr not found'); process.exit(1); }
  console.log('\nadmin :', admin.username, '(' + admin.id + ')');
  console.log('mgr   :', mgr.username,   '(' + mgr.id   + ')');

  await c.query('begin');
  try {
    await c.query(`set local "request.jwt.claim.sub" = '${admin.id}'`);
    // Clean slate.
    await c.query(
      `delete from public.shift_sessions where user_id=$1 and work_date=(now() at time zone 'UTC')::date`,
      [mgr.id],
    );
    await c.query(`delete from public.shift_configs where user_id=$1`, [mgr.id]);
    await c.query(`
      insert into public.shift_configs (
        user_id, mode, shift_break_seconds, bio_break_max_per_day,
        bio_break_warn_count, bio_break_warn_total_seconds, bio_break_max_seconds_each,
        primary_group_id, timezone, late_start_threshold_seconds, account_locked
      ) values ($1, 'hard', 1800, 7, 4, 1200, 360, null, 'Asia/Manila', 900, false)
    `, [mgr.id]);

    // Start the shift as the manager.
    await c.query(`set local "request.jwt.claim.sub" = '${mgr.id}'`);
    const { rows: [s] } = await c.query<{ res: { session_id: string } }>(
      `select public.shift_start() as res`,
    );
    const sid = s.res.session_id;
    console.log('\nshift_start →', s.res);

    // ============ (a) shift break once per day ============
    console.log('\n========== (a) shift_take_shift_break twice ==========');
    const { rows: [b1] } = await c.query<{ res: Resp }>(
      `select public.shift_take_shift_break($1) as res`, [sid],
    );
    console.log('  first call  →', b1.res);
    if (b1.res.blocked !== false) throw new Error('(a) FAIL — first call should not be blocked');
    if (b1.res.status !== 'on_shift_break') throw new Error('(a) FAIL — first call should flip to on_shift_break');

    const { rows: [after1] } = await c.query<{ status: string; cnt: number }>(
      `select status, shift_break_count_today as cnt from public.shift_sessions where id = $1`, [sid],
    );
    console.log('  session after first :', after1);
    if (after1.cnt !== 1) throw new Error('(a) FAIL — shift_break_count_today should be 1');

    // Simulate end-of-break (so status returns to 'active' for the next attempt).
    await c.query(`set local "request.jwt.claim.sub" = '${admin.id}'`);
    await c.query(
      `update public.shift_sessions set status='active', current_break_started_at=null, current_break_kind=null where id=$1`,
      [sid],
    );
    await c.query(`set local "request.jwt.claim.sub" = '${mgr.id}'`);

    const { rows: [b2] } = await c.query<{ res: Resp }>(
      `select public.shift_take_shift_break($1) as res`, [sid],
    );
    console.log('  second call →', b2.res);
    if (b2.res.blocked !== true) throw new Error('(a) FAIL — second call should be blocked');
    if (b2.res.reason !== 'shift_break_used_today') throw new Error('(a) FAIL — wrong reason');

    // Confirm only ONE shift_break_start event was created.
    const { rows: [evCnt] } = await c.query<{ n: string }>(
      `select count(*)::text as n from public.shift_events where session_id=$1 and type='shift_break_start'`, [sid],
    );
    console.log('  shift_break_start events for this session:', evCnt.n);
    if (evCnt.n !== '1') throw new Error('(a) FAIL — expected exactly 1 shift_break_start event');
    console.log('  ✅ shift break is once per day');

    // ============ (b) bio break hard limit ============
    console.log('\n========== (b) bio break at hard limit ==========');
    // Reset to active state and push the counter to the max.
    await c.query(`set local "request.jwt.claim.sub" = '${admin.id}'`);
    await c.query(
      `update public.shift_sessions set status='active', bio_break_count_today=7,
              bio_break_admin_grants_today=0 where id=$1`,
      [sid],
    );
    // Count bio_break_requests rows BEFORE for this user (should not grow).
    const { rows: [reqB] } = await c.query<{ n: string }>(
      `select count(*)::text as n from public.bio_break_requests where user_id=$1`, [mgr.id],
    );

    await c.query(`set local "request.jwt.claim.sub" = '${mgr.id}'`);
    const { rows: [bio] } = await c.query<{ res: Resp }>(
      `select public.shift_take_bio_break($1) as res`, [sid],
    );
    console.log('  shift_take_bio_break →', bio.res);
    if (bio.res.limit_reached !== true) throw new Error('(b) FAIL — should return limit_reached:true');
    // PostgreSQL JSON numbers come back as numbers — be flexible with type.
    const cnt = Number(bio.res.count_today);
    const max = Number(bio.res.max_per_day);
    if (cnt !== 7 || max !== 7) throw new Error('(b) FAIL — count_today / max_per_day wrong');

    const { rows: [reqA] } = await c.query<{ n: string }>(
      `select count(*)::text as n from public.bio_break_requests where user_id=$1`, [mgr.id],
    );
    console.log('  bio_break_requests rows: before=' + reqB.n + ' after=' + reqA.n);
    if (reqA.n !== reqB.n) throw new Error('(b) FAIL — no new bio_break_requests row should be created');
    console.log('  ✅ bio break is a hard stop — no admin request created');

  } finally {
    await c.query('rollback');
    console.log('\n(rolled back — no data persisted)');
  }

  console.log('\n✅ 0067 verified.');
  await c.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
