/**
 * Verify 0041 + Part 2B login flow end-to-end against the LIVE deployment.
 *
 * Steps:
 *  0. Confirm migration 0041 is present (resolve_login_email exists, granted to anon).
 *  1. Accept one of the pending delivered@resend.dev invites so we have a
 *     real-email user to test against. Skip if a delivered@resend.dev user
 *     already exists.
 *  2. Probe resolve_login_email for every login-shaped input.
 *  3. Reproduce the actual frontend flow (resolve → signInWithPassword) for:
 *     (a) existing username-only user (admin)
 *     (b) the new real-email user, by username
 *     (c) the new real-email user, by real email
 *     (d) wrong password + nonexistent identifier → generic failure
 */
import './loadEnv';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';

const SUPABASE_URL  = process.env.VITE_SUPABASE_URL!;
const ANON_KEY      = process.env.VITE_SUPABASE_ANON_KEY!;
const DATABASE_URL  = process.env.DATABASE_URL!;
const ADMIN_PASS    = 'admin1234';
const NEW_USERNAME  = 'rtester';
const NEW_FULLNAME  = 'Real-email Tester';
const NEW_PASSWORD  = 'realEmailPass!9';
const REAL_EMAIL    = 'delivered@resend.dev';

function fresh() { return createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } }); }

async function rpcResolve(identifier: string): Promise<string | null> {
  const sb = fresh();
  const { data, error } = await sb.rpc('resolve_login_email', { p_identifier: identifier });
  if (error) { console.error('  RPC error:', error.message); return null; }
  return (data as string | null) ?? null;
}

async function signinViaRpc(identifier: string, password: string): Promise<{ ok: boolean; email: string; reason?: string }> {
  const resolved = await rpcResolve(identifier);
  // Mirror the frontend fallback exactly.
  const email = resolved ?? (identifier.includes('@') ? identifier.trim().toLowerCase() : `${identifier.trim().toLowerCase()}@pms.internal`);
  const sb = fresh();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.session) return { ok: false, email, reason: error?.message ?? 'no session' };
  return { ok: true, email };
}

async function main() {
  const db = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();

  // -------- 0. confirm migration shape --------
  const { rows: [fn] } = await db.query<{ exists: boolean }>(
    `select exists (select 1 from pg_proc
       where proname='resolve_login_email' and pronamespace='public'::regnamespace) as exists;`,
  );
  console.log('0) resolve_login_email exists?      ' + (fn.exists ? 'YES' : 'NO'));

  // -------- 1. ensure a delivered@resend.dev user exists --------
  const { rows: existing } = await db.query<{ id: string; username: string; email: string }>(
    `select id, username, email from public.users
      where lower(email) = $1 and status = 'active' limit 1;`,
    [REAL_EMAIL.toLowerCase()],
  );
  let realEmailUsername = existing[0]?.username;
  if (existing.length > 0) {
    console.log('1) Existing real-email user: @' + existing[0].username + ' (' + existing[0].email + ')');
  } else {
    console.log('1) Accepting one pending invite for ' + REAL_EMAIL + ' …');
    const { rows: invite } = await db.query<{ token: string }>(
      `select token from public.invites
        where lower(invitee_email) = $1
          and used_at is null and revoked_at is null
          and (expires_at is null or expires_at > now())
        order by created_at asc limit 1;`,
      [REAL_EMAIL.toLowerCase()],
    );
    if (invite.length === 0) {
      console.error('   NO pending invite found — re-run Part 2A flow first.');
      await db.end();
      process.exit(1);
    }
    const sb = fresh();
    const { data, error } = await sb.rpc('accept_invite', {
      p_token:     invite[0].token,
      p_username:  NEW_USERNAME,
      p_full_name: NEW_FULLNAME,
      p_password:  NEW_PASSWORD,
    });
    if (error) { console.error('   accept_invite error:', error.message); await db.end(); process.exit(1); }
    realEmailUsername = NEW_USERNAME;
    console.log('   accepted: ' + JSON.stringify(data));
  }
  console.log('');

  // -------- 2. resolve probes --------
  console.log('2) RPC resolve probes:');
  for (const probe of ['admin', 'ADMIN', 'admin@pms.internal', realEmailUsername!, REAL_EMAIL, REAL_EMAIL.toUpperCase(), 'nope_no_such_user', '']) {
    const r = await rpcResolve(probe);
    console.log("   resolve_login_email(" + JSON.stringify(probe) + ") = " + JSON.stringify(r));
  }
  console.log('');

  // -------- 3. End-to-end sign-in probes (frontend flow) --------
  console.log('3) End-to-end sign-in (resolve -> signInWithPassword):');

  console.log('  (a) admin / ' + ADMIN_PASS + '  [legacy username-only user]');
  const a = await signinViaRpc('admin', ADMIN_PASS);
  console.log('       -> email=' + a.email + '   ok=' + a.ok + (a.reason ? '  reason=' + a.reason : ''));

  console.log('  (b) ' + realEmailUsername + ' / <pw>  [real-email user, by USERNAME]');
  const b = await signinViaRpc(realEmailUsername!, NEW_PASSWORD);
  console.log('       -> email=' + b.email + '   ok=' + b.ok + (b.reason ? '  reason=' + b.reason : ''));

  console.log('  (c) ' + REAL_EMAIL + ' / <pw>  [real-email user, by REAL EMAIL]');
  const c = await signinViaRpc(REAL_EMAIL, NEW_PASSWORD);
  console.log('       -> email=' + c.email + '   ok=' + c.ok + (c.reason ? '  reason=' + c.reason : ''));

  console.log('  (d1) admin / WRONG-PASSWORD  [should fail generically]');
  const d1 = await signinViaRpc('admin', 'WRONGwrong999');
  console.log('       -> email=' + d1.email + '   ok=' + d1.ok + '   reason=' + d1.reason);

  console.log('  (d2) ghost_user_xyz / anything  [nonexistent identifier]');
  const d2 = await signinViaRpc('ghost_user_xyz', 'whatever123');
  console.log('       -> email=' + d2.email + '   ok=' + d2.ok + '   reason=' + d2.reason);

  console.log('  (d3) ghost@nowhere.test / anything  [email-shape, nonexistent]');
  const d3 = await signinViaRpc('ghost@nowhere.test', 'whatever123');
  console.log('       -> email=' + d3.email + '   ok=' + d3.ok + '   reason=' + d3.reason);

  // Tabulated PASS/FAIL summary.
  console.log('');
  console.log('SUMMARY:');
  console.log('  (a) legacy user by username    : ' + (a.ok ? 'PASS' : 'FAIL'));
  console.log('  (b) real-email user by username: ' + (b.ok ? 'PASS' : 'FAIL'));
  console.log('  (c) real-email user by email   : ' + (c.ok ? 'PASS' : 'FAIL'));
  console.log('  (d1) wrong password rejected   : ' + (!d1.ok ? 'PASS' : 'FAIL'));
  console.log('  (d2) ghost username rejected   : ' + (!d2.ok ? 'PASS' : 'FAIL'));
  console.log('  (d3) ghost email rejected      : ' + (!d3.ok ? 'PASS' : 'FAIL'));

  await db.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
