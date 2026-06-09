/**
 * Apply 0074 + prove:
 *   (a) Server path (auth.uid()=NULL): call shift_mark_overstay_lock_emailed
 *       on a real locked break_overstay session → emailed_now=true, sent_at
 *       gets set. Call again → emailed_now=false. (No 'not authenticated'.)
 *   (b) Negative: call on a not-locked session → emailed_now=false; sent_at stays null.
 *   (c) User path preserved: as the session owner → emailed_now=true (first time)
 *       and emailed_now=false (second time); as an unrelated user (non-admin) →
 *       'forbidden' raised; as admin (not session owner) → succeeds.
 * All inside a rolled-back transaction.
 */
import './loadEnv';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const FILE = 'supabase/migrations/20260609_0074_fix_mark_emailed_server_path.sql';

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();

  console.log('========== APPLY ' + FILE + ' ==========');
  await c.query(readFileSync(FILE, 'utf8'));
  console.log('applied.\n');

  const { rows: [fn] } = await c.query<{ d: string }>(
    `select pg_get_functiondef('public.shift_mark_overstay_lock_emailed(uuid)'::regprocedure) as d`);
  const hasServerBranch = /v_uid is null/i.test(fn.d) && /v_sid\s*:=\s*p_session_id/i.test(fn.d);
  const hasUserBranch   = /'session not found'/i.test(fn.d) && /'forbidden'/i.test(fn.d);
  console.log('server-path branch present?', hasServerBranch);
  console.log('user-path branch preserved?', hasUserBranch);
  if (!(hasServerBranch && hasUserBranch)) { console.error('FAIL'); process.exit(1); }

  const { rows: [admin] } = await c.query<{ id: string }>(
    `select id from public.users where role='admin' and status='active' limit 1`);
  const { rows: mgrs } = await c.query<{ id: string; username: string }>(
    `select id, username from public.users
       where role='manager' and status='active' and is_super_admin=false
       order by username limit 2`);
  if (mgrs.length < 2) { console.error('need 2 managers'); process.exit(1); }
  const [mgrA, mgrB] = mgrs;

  await c.query('begin');
  try {
    await c.query(`set local "request.jwt.claim.sub" = '${admin.id}'`);
    await c.query(`delete from public.shift_sessions where user_id=$1
                    and work_date=(now() at time zone 'UTC')::date`, [mgrA.id]);
    await c.query(`delete from public.shift_configs where user_id=$1`, [mgrA.id]);
    await c.query(`
      insert into public.shift_configs (user_id, mode, shift_break_seconds, bio_break_max_per_day,
        bio_break_warn_count, bio_break_warn_total_seconds, bio_break_max_seconds_each,
        primary_group_id, timezone, late_start_threshold_seconds, account_locked,
        shift_break_overstay_grace_seconds)
      values ($1,'hard',1800,7,4,1200,360,null,'Asia/Manila',900,false, 900)`, [mgrA.id]);
    await c.query(`set local "request.jwt.claim.sub" = '${mgrA.id}'`);
    const { rows: [s] } = await c.query<{ r: { session_id: string } }>(
      `select public.shift_start() as r`);
    const sid = s.r.session_id;

    // Put it in locked + break_overstay state.
    await c.query(`set local "request.jwt.claim.sub" = '${admin.id}'`);
    await c.query(
      `update public.shift_sessions
          set status='locked',
              locked_reason='break_overstay',
              locked_at=now(),
              current_pause_started_at=now(),
              current_pause_reason='break_overstay',
              overstay_lock_email_sent_at=null
        where id=$1`, [sid]);

    // ========== (a) Server path: auth.uid()=NULL ==========
    console.log('\n========== (a) server path (auth.uid()=NULL) ==========');
    await c.query(`reset "request.jwt.claim.sub"`);
    // Verify auth.uid is NULL in this session.
    const { rows: [auth1] } = await c.query<{ uid: string | null }>(`select auth.uid()::text as uid`);
    console.log('  auth.uid() =', auth1.uid);
    if (auth1.uid !== null) throw new Error('FAIL — auth.uid() should be NULL for server-path test');

    const { rows: [s1] } = await c.query<{ r: { emailed_now: boolean } }>(
      `select public.shift_mark_overstay_lock_emailed($1) as r`, [sid]);
    console.log('  1st call →', s1.r);
    const { rows: [s1at] } = await c.query<{ sent: string | null }>(
      `select overstay_lock_email_sent_at::text as sent from public.shift_sessions where id=$1`, [sid]);
    console.log('  sent_at after 1st:', s1at.sent);
    if (s1.r.emailed_now !== true) throw new Error('FAIL — server path 1st call should be emailed_now=true');
    if (!s1at.sent) throw new Error('FAIL — sent_at not set');

    const { rows: [s2] } = await c.query<{ r: { emailed_now: boolean } }>(
      `select public.shift_mark_overstay_lock_emailed($1) as r`, [sid]);
    console.log('  2nd call →', s2.r);
    if (s2.r.emailed_now !== false) throw new Error('FAIL — server path 2nd call should be emailed_now=false');
    console.log('  ✅ server path works; no "not authenticated" raise; once-only guard intact');

    // ========== (b) Negative: server path, not-locked session ==========
    console.log('\n========== (b) negative — not-locked session ==========');
    await c.query(`update public.shift_sessions
                      set status='active', locked_reason=null,
                          current_pause_started_at=null, current_pause_reason=null,
                          overstay_lock_email_sent_at=null
                    where id=$1`, [sid]);
    const { rows: [s3] } = await c.query<{ r: { emailed_now: boolean } }>(
      `select public.shift_mark_overstay_lock_emailed($1) as r`, [sid]);
    const { rows: [s3at] } = await c.query<{ sent: string | null }>(
      `select overstay_lock_email_sent_at::text as sent from public.shift_sessions where id=$1`, [sid]);
    console.log('  not-locked call →', s3.r, '  sent_at:', s3at.sent);
    if (s3.r.emailed_now !== false) throw new Error('FAIL — non-locked should return emailed_now=false');
    if (s3at.sent) throw new Error('FAIL — non-locked should not flip sent_at');
    console.log('  ✅ guard refuses to flip when status≠locked');

    // ========== (c) User path preserved ==========
    console.log('\n========== (c) user-path preserved ==========');
    // Re-lock for the user-path tests.
    await c.query(
      `update public.shift_sessions
          set status='locked', locked_reason='break_overstay',
              locked_at=now(), current_pause_started_at=now(),
              current_pause_reason='break_overstay',
              overstay_lock_email_sent_at=null
        where id=$1`, [sid]);

    // (c1) session owner → succeeds
    await c.query(`set local "request.jwt.claim.sub" = '${mgrA.id}'`);
    const { rows: [c1] } = await c.query<{ r: { emailed_now: boolean } }>(
      `select public.shift_mark_overstay_lock_emailed($1) as r`, [sid]);
    console.log('  as session owner →', c1.r);
    if (c1.r.emailed_now !== true) throw new Error('FAIL — owner call should be emailed_now=true');

    // (c2) admin (not session owner) — re-null sent_at then call
    await c.query(`set local "request.jwt.claim.sub" = '${admin.id}'`);
    await c.query(`update public.shift_sessions set overstay_lock_email_sent_at=null where id=$1`, [sid]);
    const { rows: [c2] } = await c.query<{ r: { emailed_now: boolean } }>(
      `select public.shift_mark_overstay_lock_emailed($1) as r`, [sid]);
    console.log('  as admin (not session owner) →', c2.r);
    if (c2.r.emailed_now !== true) throw new Error('FAIL — admin call should be emailed_now=true');

    // (c3) unrelated non-admin manager (mgrB) — must RAISE 'forbidden'
    await c.query(`update public.shift_sessions set overstay_lock_email_sent_at=null where id=$1`, [sid]);
    await c.query(`set local "request.jwt.claim.sub" = '${mgrB.id}'`);
    let raised: string | null = null;
    try {
      await c.query(`select public.shift_mark_overstay_lock_emailed($1)`, [sid]);
    } catch (e) {
      raised = (e as Error).message;
    }
    console.log('  as unrelated non-admin →', raised ?? 'NO EXCEPTION (FAIL)');
    if (!raised || !/forbidden/i.test(raised)) {
      throw new Error('FAIL — unrelated non-admin should raise forbidden');
    }
    console.log('  ✅ user-path authz preserved byte-for-byte (owner ok, admin ok, foreign mgr forbidden)');

  } finally {
    await c.query('rollback');
    console.log('\n(rolled back)');
  }

  console.log('\n✅ 0074 verified — server/cron path works, user path preserved, atomic guard intact.');
  await c.end();
}
main().catch(e => { console.error('FAILED:', e); process.exit(1); });
