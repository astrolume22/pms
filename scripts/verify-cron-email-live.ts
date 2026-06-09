/**
 * Live verify the server-side cron email path end-to-end:
 *   1. Set rtester (Resend test address) into a lock-eligible shift break.
 *      COMMIT the row (cron worker can't see uncommitted rows).
 *   2. Wait for the per-minute cron to fire (poll up to 90s).
 *   3. Inspect net._http_response — assert a 2xx from /api/shift-alert-email,
 *      and that no 'sweep_email_skipped_no_secret' event was inserted.
 *   4. Cleanup: shift_admin_unlock the session + delete the test config/session.
 *      Tell the founder exactly what was cleaned.
 */
import './loadEnv';
import { Client } from 'pg';

const TARGET_USERNAME = 'rtester'; // safe Resend test mailbox

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const { rows: [admin] } = await c.query<{ id: string }>(
    `select id from public.users where role='admin' and status='active' limit 1`);
  const { rows: [mgr] } = await c.query<{ id: string; username: string; email: string }>(
    `select id, username, email from public.users where username=$1`, [TARGET_USERNAME]);
  if (!mgr) { console.error('FAIL — target user ' + TARGET_USERNAME + ' not found'); process.exit(1); }

  // Mask the email for log output (we know which manager, no need to log the full address).
  const maskedEmail = mgr.email.replace(/^([a-z0-9])[^@]*(@.*)$/i, '$1***$2');
  console.log('target user:', mgr.username, '(' + maskedEmail + ')   id=' + mgr.id);

  // Snapshot the largest net._http_response id BEFORE so we can find new rows.
  const { rows: [pre] } = await c.query<{ max_id: number | null }>(
    `select coalesce(max(id), 0) as max_id from net._http_response`);
  const preMaxId = pre.max_id ?? 0;
  console.log('net._http_response max id before:', preMaxId);

  // ===== Setup (committed) — small allowance/grace + backdate =====
  // We use NOT a transaction so the cron worker sees these rows.
  await c.query(`set "request.jwt.claim.sub" = '${admin.id}'`);
  await c.query(
    `delete from public.shift_sessions where user_id=$1
        and work_date=(now() at time zone 'UTC')::date`, [mgr.id]);
  await c.query(`delete from public.shift_configs where user_id=$1`, [mgr.id]);
  await c.query(`
    insert into public.shift_configs (user_id, mode, shift_break_seconds, bio_break_max_per_day,
      bio_break_warn_count, bio_break_warn_total_seconds, bio_break_max_seconds_each,
      primary_group_id, timezone, late_start_threshold_seconds, account_locked,
      shift_break_overstay_grace_seconds)
    values ($1,'hard',60,7,4,1200,360,null,'Asia/Manila',900,false, 30)`, [mgr.id]);

  await c.query(`set "request.jwt.claim.sub" = '${mgr.id}'`);
  const { rows: [s] } = await c.query<{ r: { session_id: string } }>(
    `select public.shift_start() as r`);
  const sid = s.r.session_id;
  await c.query(`select public.shift_take_shift_break($1)`, [sid]);

  await c.query(`set "request.jwt.claim.sub" = '${admin.id}'`);
  // allowance=60 + grace=30 = 90; backdate 120s → lock-eligible.
  // Also reset overstay_lock_email_sent_at so the email guard allows fire.
  await c.query(`
    update public.shift_sessions
       set current_break_started_at  = now() - interval '120 seconds',
           overstay_lock_email_sent_at = null
     where id=$1`, [sid]);

  const { rows: [before] } = await c.query<{
    status: string; locked_reason: string | null; sent: string | null;
  }>(`select status, locked_reason, overstay_lock_email_sent_at::text as sent
        from public.shift_sessions where id=$1`, [sid]);
  console.log('\n===== BEFORE waiting for cron =====');
  console.log('  session ' + sid + ':', before);
  console.log('  current UTC second-of-minute:', new Date().getUTCSeconds());

  // ===== Poll up to 90s for the cron =====
  console.log('\n===== Waiting for cron (poll every 15s, up to 90s) =====');
  let lockedSeen = false;
  let waited = 0;
  const POLL_MS = 15_000;
  const MAX_MS  = 90_000;
  let after: typeof before | null = null;
  while (waited < MAX_MS) {
    await sleep(POLL_MS);
    waited += POLL_MS;
    const { rows: [cur] } = await c.query<typeof before>(
      `select status, locked_reason, overstay_lock_email_sent_at::text as sent
         from public.shift_sessions where id=$1`, [sid]);
    console.log('  +' + (waited / 1000) + 's:', cur);
    if (cur.status === 'locked' && cur.locked_reason === 'break_overstay') {
      lockedSeen = true;
      after = cur;
      break;
    }
  }

  // ===== Inspect net._http_response (new rows since the snapshot) =====
  // pg_net writes to net._http_response after the async request settles.
  // Give it a beat to settle if needed.
  await sleep(2_000);
  const { rows: responses } = await c.query<{
    id: number; status_code: number | null; content_type: string | null;
    timed_out: boolean | null; error_msg: string | null; created: string; body_snippet: string | null;
  }>(`
    select id, status_code, content_type, timed_out, error_msg,
           created::text as created,
           left(content, 500) as body_snippet
      from net._http_response
     where id > $1
     order by id desc`, [preMaxId]);
  console.log('\n===== net._http_response rows since pre-snapshot =====');
  if (responses.length === 0) console.log('  (none yet — async queue may not have settled)');
  for (const r of responses) {
    console.log('  id=' + r.id
      + '  status_code=' + r.status_code
      + '  content_type=' + r.content_type
      + '  timed_out=' + r.timed_out
      + '  error=' + r.error_msg
      + '\n    body=' + r.body_snippet);
  }

  // ===== Was the email path SKIPPED for any reason? =====
  const { rows: skips } = await c.query<{ at: string; meta: Record<string, unknown> }>(`
    select at::text, meta
      from public.shift_events
     where session_id=$1
       and type='admin_override'
       and meta->>'action' in ('sweep_email_skipped_no_secret', 'sweep_email_http_post_failed')
     order by at desc`, [sid]);
  console.log('\n===== sweep skip/failure events for this session (expect EMPTY) =====');
  for (const e of skips) console.log('  ', e);

  // ===== cron.job_run_details around the lock window =====
  const { rows: runDetails } = await c.query<{
    runid: number; status: string; return_message: string; start_time: string;
  }>(`
    select runid, status, return_message, start_time::text
      from cron.job_run_details
     where jobid = (select jobid from cron.job where jobname='shift_break_sweep')
     order by start_time desc limit 5`);
  console.log('\n===== cron.job_run_details (most recent 5) =====');
  for (const r of runDetails) console.log('  ', r);

  // ===== CLEANUP =====
  console.log('\n===== CLEANUP =====');
  try {
    await c.query(`set "request.jwt.claim.sub" = '${admin.id}'`);
    if (lockedSeen) {
      const { rows: [u] } = await c.query<{ r: Record<string, unknown> }>(
        `select public.shift_admin_unlock($1) as r`, [sid]);
      console.log('  shift_admin_unlock →', u.r);
    } else {
      console.log('  (no unlock needed — session was not locked)');
    }
    await c.query(`delete from public.shift_sessions where id=$1`, [sid]);
    await c.query(`delete from public.shift_configs where user_id=$1`, [mgr.id]);
    console.log('  ✅ test shift_sessions row deleted');
    console.log('  ✅ test shift_configs row deleted');
  } catch (e) {
    console.warn('  WARN — cleanup error:', e);
  }

  // ===== Verdict =====
  console.log('\n===== VERDICT =====');
  if (!lockedSeen) {
    console.log('  ❌ cron did not lock within 90s — see cron.job_run_details');
  } else {
    console.log('  ✅ session was locked by cron at:', after?.sent);
    const goodResp = responses.find((r) => r.status_code !== null && r.status_code >= 200 && r.status_code < 300);
    const failResp = responses.find((r) => r.status_code !== null && (r.status_code === 401 || r.status_code === 403));
    if (skips.length > 0) {
      console.log('  ❌ sweep_email_skipped/failed event present — secret mismatch or HTTP error.');
    } else if (failResp) {
      console.log('  ❌ Vercel function returned ' + failResp.status_code + ' — secret mismatch.');
      console.log('     body:', failResp.body_snippet);
    } else if (goodResp) {
      console.log('  ✅ Vercel /api/shift-alert-email returned ' + goodResp.status_code + ' — server cron email PROVEN.');
    } else if (responses.length === 0) {
      console.log('  ⚠ no net._http_response row found yet — async queue still settling or pg_net config issue.');
    } else {
      console.log('  ⚠ unexpected: response present but neither clearly success nor auth-failure.');
      for (const r of responses) console.log('   ', r);
    }
  }

  await c.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
