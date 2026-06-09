/**
 * Apply 0073 + prove:
 *   (a) BIO-6 pass: set bio_break_count_today=6 + bio6_notified_at=null
 *       → run sweep → assert one admin notification per admin AND
 *       bio6_notified_at got set; sweep AGAIN → counters return 0 / no
 *       new notifications (once-per-day).
 *   (b) LOCK pass: lock-eligible session with overstay_lock_email_sent_at=null
 *       → run sweep → assert lock applied, overstay_lock_email_sent_at SET,
 *       admin notification inserted, emailed_count=1; sweep AGAIN → no
 *       new lock-notifications, no re-set, emailed_count=0.
 *   Everything inside a transaction that rolls back. pg_net's queued
 *   request gets rolled back too — that's fine; we test the GUARD logic.
 */
import './loadEnv';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const FILE = 'supabase/migrations/20260609_0073_sweep_server_alerts.sql';

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();

  console.log('========== APPLY ' + FILE + ' ==========');
  await c.query(readFileSync(FILE, 'utf8'));
  console.log('applied.\n');

  // Quick sanity on the extended function shape.
  const { rows: [fn] } = await c.query<{ d: string }>(
    `select pg_get_functiondef('public.shift_break_sweep()'::regprocedure) as d`);
  const hasBio6 = /bio6_notified_at/.test(fn.d) && /PASS 3 — BIO-6/.test(fn.d);
  const hasMark = /shift_mark_overstay_lock_emailed/.test(fn.d);
  const hasNet  = /net\.http_post/.test(fn.d);
  console.log('sweep has BIO-6 pass?', hasBio6);
  console.log('sweep calls shift_mark_overstay_lock_emailed?', hasMark);
  console.log('sweep calls net.http_post?', hasNet);
  if (!(hasBio6 && hasMark && hasNet)) { console.error('FAIL'); process.exit(1); }

  const { rows: admins } = await c.query<{ id: string }>(
    `select id from public.users where status='active' and (role='admin' or is_super_admin=true)`);
  const adminCount = admins.length;
  console.log('\nactive admins (recipient_id targets):', adminCount);

  const { rows: [mgrA] } = await c.query<{ id: string; username: string }>(
    `select id, username from public.users
       where role='manager' and status='active' and is_super_admin=false
       order by username limit 1`);
  const { rows: [mgrB] } = await c.query<{ id: string; username: string }>(
    `select id, username from public.users
       where role='manager' and status='active' and is_super_admin=false
       order by username limit 1 offset 1`);

  await c.query('begin');
  try {
    await c.query(`set local "request.jwt.claim.sub" = '${admins[0].id}'`);

    // Reset both managers' sessions/configs.
    for (const m of [mgrA, mgrB]) {
      await c.query(`delete from public.shift_sessions where user_id=$1
                      and work_date=(now() at time zone 'UTC')::date`, [m.id]);
      await c.query(`delete from public.shift_configs where user_id=$1`, [m.id]);
      await c.query(`
        insert into public.shift_configs (user_id, mode, shift_break_seconds, bio_break_max_per_day,
          bio_break_warn_count, bio_break_warn_total_seconds, bio_break_max_seconds_each,
          primary_group_id, timezone, late_start_threshold_seconds, account_locked,
          shift_break_overstay_grace_seconds)
        values ($1,'hard',1800,7,4,1200,360,null,'Asia/Manila',900,false, 900)`, [m.id]);
      await c.query(`set local "request.jwt.claim.sub" = '${m.id}'`);
      await c.query(`select public.shift_start()`);
      await c.query(`set local "request.jwt.claim.sub" = '${admins[0].id}'`);
    }

    // Snapshot notifications baseline (for the admin recipients).
    const { rows: [nBase] } = await c.query<{ n: string }>(
      `select count(*)::text as n from public.notifications where recipient_id = any($1)
         and type='shift_admin_alert'`, [admins.map(a => a.id)]);

    // ========== (a) BIO-6 ==========
    console.log('\n========== (a) BIO-6 alert ==========');
    // Set up mgrA: bio=6, flag null. Status stays 'active'.
    const { rows: [aSess] } = await c.query<{ id: string }>(
      `select id from public.shift_sessions where user_id=$1
         and work_date=(now() at time zone 'UTC')::date`, [mgrA.id]);
    const sidA = aSess.id;
    await c.query(`update public.shift_sessions
                      set bio_break_count_today=6, bio6_notified_at=null
                    where id=$1`, [sidA]);
    const { rows: [aBefore] } = await c.query<{ flag: string | null }>(
      `select bio6_notified_at::text as flag from public.shift_sessions where id=$1`, [sidA]);
    console.log('  BEFORE: bio6_notified_at =', aBefore.flag);

    const { rows: [r1] } = await c.query<{ r: Record<string, unknown> }>(
      `select public.shift_break_sweep() as r`);
    console.log('  sweep #1 returned:', r1.r);

    const { rows: [aAfter] } = await c.query<{ flag: string | null }>(
      `select bio6_notified_at::text as flag from public.shift_sessions where id=$1`, [sidA]);
    const { rows: [nAfter1] } = await c.query<{ n: string }>(
      `select count(*)::text as n from public.notifications
         where recipient_id = any($1) and actor_id=$2 and type='shift_admin_alert'`,
      [admins.map(a => a.id), mgrA.id]);
    console.log('  AFTER:  bio6_notified_at =', aAfter.flag);
    console.log('  AFTER:  admin notifications for actor=mgrA =', nAfter1.n);
    if (!aAfter.flag) throw new Error('(a) FAIL — bio6_notified_at not set');
    if (parseInt(nAfter1.n, 10) !== adminCount)
      throw new Error('(a) FAIL — expected ' + adminCount + ' notifications, got ' + nAfter1.n);
    if (Number(r1.r.bio6_notified_count) !== 1)
      throw new Error('(a) FAIL — bio6_notified_count should be 1');
    console.log('  ✅ bio6_notified_at set; admin notifications inserted (' + nAfter1.n + ')');

    // Run again — must be a no-op.
    const { rows: [r1b] } = await c.query<{ r: Record<string, unknown> }>(
      `select public.shift_break_sweep() as r`);
    const { rows: [nAfter1b] } = await c.query<{ n: string }>(
      `select count(*)::text as n from public.notifications
         where recipient_id = any($1) and actor_id=$2 and type='shift_admin_alert'`,
      [admins.map(a => a.id), mgrA.id]);
    console.log('  sweep #2 returned:', r1b.r);
    if (Number(r1b.r.bio6_notified_count) !== 0) throw new Error('(a) FAIL — sweep #2 should bio6=0');
    if (nAfter1b.n !== nAfter1.n) throw new Error('(a) FAIL — sweep #2 should not add notifications');
    console.log('  ✅ idempotent (no duplicate notifications)');

    // ========== (b) LOCK + email guard + notification ==========
    console.log('\n========== (b) LOCK with email guard + admin notification ==========');
    // Drive mgrB into lock-eligible state.
    await c.query(`set local "request.jwt.claim.sub" = '${mgrB.id}'`);
    const { rows: [bSess] } = await c.query<{ id: string }>(
      `select id from public.shift_sessions where user_id=$1
         and work_date=(now() at time zone 'UTC')::date`, [mgrB.id]);
    const sidB = bSess.id;
    await c.query(`select public.shift_take_shift_break($1)`, [sidB]);
    await c.query(`set local "request.jwt.claim.sub" = '${admins[0].id}'`);
    // allowance=1800 + grace=900 = 2700; 2800 > 2700 → lock eligible.
    await c.query(`update public.shift_sessions
                      set current_break_started_at = now() - interval '2800 seconds',
                          overstay_lock_email_sent_at = null
                    where id=$1`, [sidB]);

    const { rows: [bBefore] } = await c.query<{
      status: string; locked_reason: string | null; sent: string | null;
    }>(`select status, locked_reason, overstay_lock_email_sent_at::text as sent
          from public.shift_sessions where id=$1`, [sidB]);
    console.log('  BEFORE sweep:', bBefore);

    const { rows: [r2] } = await c.query<{ r: Record<string, unknown> }>(
      `select public.shift_break_sweep() as r`);
    console.log('  sweep #1 returned:', r2.r);

    const { rows: [bAfter] } = await c.query<{
      status: string; locked_reason: string | null; sent: string | null;
    }>(`select status, locked_reason, overstay_lock_email_sent_at::text as sent
          from public.shift_sessions where id=$1`, [sidB]);
    const { rows: [nLockB] } = await c.query<{ n: string }>(
      `select count(*)::text as n from public.notifications
         where recipient_id = any($1) and actor_id=$2 and type='shift_admin_alert'`,
      [admins.map(a => a.id), mgrB.id]);
    console.log('  AFTER:  ', bAfter);
    console.log('  AFTER:  admin lock-notifications for actor=mgrB =', nLockB.n);
    if (bAfter.status !== 'locked') throw new Error('(b) FAIL — status should be locked');
    if (bAfter.locked_reason !== 'break_overstay') throw new Error('(b) FAIL — locked_reason');
    if (!bAfter.sent) throw new Error('(b) FAIL — overstay_lock_email_sent_at not set');
    if (parseInt(nLockB.n, 10) !== adminCount)
      throw new Error('(b) FAIL — expected ' + adminCount + ' lock notifications, got ' + nLockB.n);
    if (Number(r2.r.locked_count) !== 1) throw new Error('(b) FAIL — locked_count should be 1');
    if (Number(r2.r.emailed_count) !== 1) throw new Error('(b) FAIL — emailed_count should be 1');
    console.log('  ✅ locked, email guard flipped, admin notifications inserted (' + nLockB.n + '), emailed_count=1');

    // Sweep again → no double-email, no extra notifications.
    const { rows: [r2b] } = await c.query<{ r: Record<string, unknown> }>(
      `select public.shift_break_sweep() as r`);
    const { rows: [nLockB2] } = await c.query<{ n: string }>(
      `select count(*)::text as n from public.notifications
         where recipient_id = any($1) and actor_id=$2 and type='shift_admin_alert'`,
      [admins.map(a => a.id), mgrB.id]);
    console.log('  sweep #2 returned:', r2b.r);
    console.log('  sweep #2 admin lock-notifications for mgrB =', nLockB2.n);
    if (Number(r2b.r.locked_count) !== 0) throw new Error('(b) FAIL — sweep #2 should not re-lock');
    if (Number(r2b.r.emailed_count) !== 0) throw new Error('(b) FAIL — sweep #2 should not re-email');
    if (nLockB2.n !== nLockB.n) throw new Error('(b) FAIL — sweep #2 should not add notifications');
    console.log('  ✅ idempotent (no re-lock, no re-email, no re-notify)');

    console.log('\n========== SUMMARY ==========');
    console.log('  notification baseline before any sweep:', nBase.n);
    console.log('  (a) bio6 sweep1=' + r1.r.bio6_notified_count + ' sweep2=' + r1b.r.bio6_notified_count);
    console.log('  (b) lock sweep1=' + r2.r.locked_count + ' email1=' + r2.r.emailed_count
              + ' lock sweep2=' + r2b.r.locked_count + ' email2=' + r2b.r.emailed_count);
  } finally {
    await c.query('rollback');
    console.log('\n(rolled back — no real notifications/emails persisted)');
  }

  console.log('\n✅ 0073 verified — server-side admin alerts work, idempotent.');
  await c.end();
}
main().catch(e => { console.error('FAILED:', e); process.exit(1); });
