/**
 * Apply 0070 + prove once-only email guard:
 *   • Seed a session as `status='locked', locked_reason='break_overstay',
 *     overstay_lock_email_sent_at=NULL`.
 *   • Call shift_mark_overstay_lock_emailed twice.
 *     - First call:  emailed_now=true, column transitions NULL → now().
 *     - Second call: emailed_now=false, column unchanged.
 *   • Confirm a not-locked session returns emailed_now=false (gate works).
 *   • All inside a transaction that rolls back.
 */
import './loadEnv';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const FILE = 'supabase/migrations/20260609_0070_overstay_lock_email_guard.sql';

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();

  console.log('========== APPLY ' + FILE + ' ==========');
  await c.query(readFileSync(FILE, 'utf8'));
  console.log('applied.\n');

  // Confirm column + function exist.
  const { rows: [col] } = await c.query<{ exists: boolean }>(`
    select exists(
      select 1 from information_schema.columns
       where table_schema='public' and table_name='shift_sessions'
         and column_name='overstay_lock_email_sent_at'
    ) as exists
  `);
  console.log('column overstay_lock_email_sent_at exists?', col.exists);
  if (!col.exists) { console.error('FAIL'); process.exit(1); }

  const { rows: [fnDef] } = await c.query<{ d: string }>(
    `select pg_get_functiondef('public.shift_mark_overstay_lock_emailed(uuid)'::regprocedure) as d`,
  );
  const hasGuard = /overstay_lock_email_sent_at\s+is\s+null/i.test(fnDef.d)
                && /locked_reason\s*=\s*'break_overstay'/i.test(fnDef.d);
  console.log('shift_mark_overstay_lock_emailed guards on (locked, break_overstay, sent_at IS NULL)?', hasGuard);
  if (!hasGuard) { console.error('FAIL'); process.exit(1); }

  const { rows: [admin] } = await c.query<{ id: string }>(
    `select id from public.users where role='admin' and status='active' limit 1`,
  );
  const { rows: [mgr] } = await c.query<{ id: string }>(
    `select id from public.users
       where role='manager' and status='active' and is_super_admin=false limit 1`,
  );

  await c.query('begin');
  try {
    await c.query(`set local "request.jwt.claim.sub" = '${admin.id}'`);
    await c.query(`delete from public.shift_sessions where user_id=$1
                    and work_date=(now() at time zone 'UTC')::date`, [mgr.id]);
    await c.query(`delete from public.shift_configs where user_id=$1`, [mgr.id]);
    await c.query(`
      insert into public.shift_configs (user_id, mode, shift_break_seconds, bio_break_max_per_day,
        bio_break_warn_count, bio_break_warn_total_seconds, bio_break_max_seconds_each,
        primary_group_id, timezone, late_start_threshold_seconds, account_locked,
        shift_break_overstay_grace_seconds)
      values ($1,'hard',1800,7,4,1200,360,null,'Asia/Manila',900,false, 60)`, [mgr.id]);
    await c.query(`set local "request.jwt.claim.sub" = '${mgr.id}'`);
    const { rows: [s] } = await c.query<{ r: { session_id: string } }>(
      `select public.shift_start() as r`,
    );
    const sid = s.r.session_id;

    // Directly put the session into the locked break_overstay state we
    // want to test (skip the chain of break + freeze + lock — those are
    // proven in apply-0069).
    await c.query(`set local "request.jwt.claim.sub" = '${admin.id}'`);
    await c.query(
      `update public.shift_sessions
          set status='locked',
              locked_reason='break_overstay',
              locked_at=now(),
              current_pause_started_at = now(),
              current_pause_reason = 'break_overstay'
        where id=$1`, [sid],
    );

    // ---------- Read BEFORE state ----------
    const before = await readSentAt(c, sid);
    console.log('\n===== BEFORE first call =====');
    console.log('  overstay_lock_email_sent_at:', before);

    // ---------- First call: should set the timestamp ----------
    await c.query(`set local "request.jwt.claim.sub" = '${mgr.id}'`);
    const { rows: [r1] } = await c.query<{ r: { emailed_now: boolean } }>(
      `select public.shift_mark_overstay_lock_emailed($1) as r`, [sid],
    );
    const after1 = await readSentAt(c, sid);
    console.log('\n===== AFTER first call =====');
    console.log('  result:', r1.r);
    console.log('  overstay_lock_email_sent_at:', after1);
    if (r1.r.emailed_now !== true) throw new Error('FAIL — first call should be emailed_now=true');
    if (!after1) throw new Error('FAIL — column should be set');

    // ---------- Second call: should be no-op ----------
    const { rows: [r2] } = await c.query<{ r: { emailed_now: boolean } }>(
      `select public.shift_mark_overstay_lock_emailed($1) as r`, [sid],
    );
    const after2 = await readSentAt(c, sid);
    console.log('\n===== AFTER second call =====');
    console.log('  result:', r2.r);
    console.log('  overstay_lock_email_sent_at:', after2);
    if (r2.r.emailed_now !== false) throw new Error('FAIL — second call should be emailed_now=false');
    if (after2 !== after1) throw new Error('FAIL — timestamp should NOT have changed on second call');

    console.log('\n  ✅ once-only guard: first NULL→now, second is no-op');

    // ---------- Negative test: not-locked session ----------
    await c.query(`set local "request.jwt.claim.sub" = '${admin.id}'`);
    await c.query(
      `update public.shift_sessions
          set status='active',
              locked_reason=null,
              overstay_lock_email_sent_at=null,
              current_pause_started_at=null,
              current_pause_reason=null
        where id=$1`, [sid],
    );
    await c.query(`set local "request.jwt.claim.sub" = '${mgr.id}'`);
    const { rows: [r3] } = await c.query<{ r: { emailed_now: boolean } }>(
      `select public.shift_mark_overstay_lock_emailed($1) as r`, [sid],
    );
    console.log('\n===== NEGATIVE: not-locked session =====');
    console.log('  result:', r3.r);
    if (r3.r.emailed_now !== false) throw new Error('FAIL — non-locked should be emailed_now=false');
    console.log('  ✅ guard refuses to set sent_at when status≠locked');

    console.log('\n========== SUMMARY ==========');
    console.log('  before:        ' + before);
    console.log('  after first:   ' + after1 + '   (emailed_now=true)');
    console.log('  after second:  ' + after2 + '   (emailed_now=false, unchanged)');

  } finally {
    await c.query('rollback');
    console.log('\n(rolled back)');
  }

  console.log('\n✅ 0070 verified — once-only email guard works.');
  await c.end();
}

async function readSentAt(c: Client, sid: string): Promise<string | null> {
  const { rows: [r] } = await c.query<{ s: string | null }>(
    `select overstay_lock_email_sent_at::text as s from public.shift_sessions where id=$1`, [sid],
  );
  return r.s;
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
