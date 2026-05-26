/**
 * End-to-end verifier for migration 0042 + Issue B fix.
 *
 * Mints a fresh invite, accepts it with only full_name + password
 * (mirroring the new frontend flow), proves auto-login by email
 * succeeds, then logs in fresh by both email and auto-generated
 * username, then admin-renames the user and reproves login by
 * the new username, and finally proves a non-admin can't call
 * admin_set_username.
 *
 *   (a) accept w/o username → auto-generated → auto-login works
 *   (b) new user row has auto username + real email
 *   (c) fresh login by email AND by auto-username
 *   (d) admin rename → row reflects new username → login still works
 *   (e) non-admin call to admin_set_username is rejected
 */
import './loadEnv';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const ANON_KEY     = process.env.VITE_SUPABASE_ANON_KEY!;
const DB_URL       = process.env.DATABASE_URL!;
const ADMIN_USER   = 'admin';
const ADMIN_PASS   = 'admin1234';

function freshClient() { return createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } }); }

async function adminSession() {
  const sb = freshClient();
  const { data, error } = await sb.auth.signInWithPassword({ email: 'admin@pms.internal', password: ADMIN_PASS });
  if (error) throw new Error('admin login failed: ' + error.message);
  return { sb, accessToken: data.session!.access_token };
}

async function mintInviteAsAdmin(email: string | null): Promise<string> {
  const { sb } = await adminSession();
  const { data, error } = await sb.rpc('create_invite', {
    p_role: 'manager',
    p_board_id: null,
    p_expires_in_hours: 24,
    p_group_id: null,
    p_invitee_email: email,
  });
  if (error) throw new Error('create_invite error: ' + error.message);
  return (data as { token: string }).token;
}

async function main() {
  const stamp     = Date.now();
  const realEmail = 'verif0042-' + stamp + '@example.test';
  const fullName  = 'Verifier User';
  const password  = 'Verifier!9pass';

  console.log('---- 0042 end-to-end proof ----\n');

  // ============ (a) accept w/o username ============
  console.log('(a) Mint invite + accept (no username field in payload)');
  const token = await mintInviteAsAdmin(realEmail);
  console.log('    token: ' + token.slice(0, 12) + '...');
  const sbAnon = freshClient();
  const acc = await sbAnon.rpc('accept_invite', {
    p_token:     token,
    p_full_name: fullName,
    p_password:  password,
  });
  if (acc.error) { console.error('    accept_invite ERROR: ' + acc.error.message); process.exit(1); }
  const accepted = acc.data as { user_id: string; username: string; email: string; board_id: string | null };
  console.log('    accept_invite returned:');
  console.log('      user_id:  ' + accepted.user_id);
  console.log('      username: ' + accepted.username + '   <-- auto-generated, no client input');
  console.log('      email:    ' + accepted.email);
  // Immediate auto-login mirroring the frontend (sign in with returned email).
  const auto = await sbAnon.auth.signInWithPassword({ email: accepted.email, password });
  console.log('    immediate auto-login: ' + (auto.data?.session ? 'OK' : 'FAIL ' + auto.error?.message));

  // ============ (b) row inspection ============
  console.log('\n(b) DB row inspection');
  const db = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  const { rows: [row] } = await db.query<{ id: string; username: string; email: string; role: string; status: string }>(
    `select id, username, email, role, status from public.users where id = $1;`,
    [accepted.user_id],
  );
  console.log('    public.users row: ' + JSON.stringify(row));

  // ============ (c) fresh login by email AND by username ============
  console.log('\n(c) Fresh login by EMAIL and by USERNAME');
  const sbA = freshClient();
  const r1  = await sbA.rpc('resolve_login_email', { p_identifier: accepted.email });
  const a1  = await sbA.auth.signInWithPassword({ email: (r1.data as string) || accepted.email, password });
  console.log('    by email    -> resolve=' + JSON.stringify(r1.data) + '   signin=' + (a1.data?.session ? 'OK' : 'FAIL'));
  const sbB = freshClient();
  const r2  = await sbB.rpc('resolve_login_email', { p_identifier: accepted.username });
  const a2  = await sbB.auth.signInWithPassword({ email: (r2.data as string) || (accepted.username + '@pms.internal'), password });
  console.log('    by username -> resolve=' + JSON.stringify(r2.data) + '   signin=' + (a2.data?.session ? 'OK' : 'FAIL'));

  // ============ (d) admin rename + login by new username ============
  console.log('\n(d) Admin rename + login still works');
  const renamed = 'renamed' + stamp.toString().slice(-5);
  const { sb: sbAdmin } = await adminSession();
  const ren = await sbAdmin.rpc('admin_set_username', { p_user_id: accepted.user_id, p_new_username: renamed });
  console.log('    admin_set_username(' + renamed + '): ' + (ren.error ? 'FAIL ' + ren.error.message : 'OK'));
  const { rows: [after] } = await db.query<{ username: string; email: string }>(
    `select username, email from public.users where id = $1;`,
    [accepted.user_id],
  );
  console.log('    row after rename: ' + JSON.stringify(after));
  const sbC = freshClient();
  const r3  = await sbC.rpc('resolve_login_email', { p_identifier: renamed });
  const a3  = await sbC.auth.signInWithPassword({ email: (r3.data as string) || (renamed + '@pms.internal'), password });
  console.log('    login by NEW username -> resolve=' + JSON.stringify(r3.data) + '   signin=' + (a3.data?.session ? 'OK' : 'FAIL'));
  const sbD = freshClient();
  const a4  = await sbD.auth.signInWithPassword({ email: accepted.email, password });
  console.log('    login by EMAIL (unchanged) -> signin=' + (a4.data?.session ? 'OK' : 'FAIL'));

  // ============ (e) non-admin blocked ============
  console.log('\n(e) Non-admin calling admin_set_username is rejected');
  const sbNonAdmin = freshClient();
  // Sign in as the just-renamed user (a manager, not an admin).
  await sbNonAdmin.auth.signInWithPassword({ email: accepted.email, password });
  // Try to rename another user (e.g. admin).
  const { rows: [adminRow] } = await db.query<{ id: string }>(`select id from public.users where username='admin' limit 1;`);
  const block = await sbNonAdmin.rpc('admin_set_username', { p_user_id: adminRow.id, p_new_username: 'evilrename' });
  console.log('    rejected? ' + (block.error ? 'YES — "' + block.error.message + '"' : 'NO (BUG)'));

  await db.end();

  console.log('\nSUMMARY:');
  console.log('  (a) auto-username on accept                 : ' + (accepted.username ? 'PASS' : 'FAIL') + '  (' + accepted.username + ')');
  console.log('  (a) immediate auto-login                    : ' + (auto.data?.session ? 'PASS' : 'FAIL'));
  console.log('  (b) row stored with auto username + email   : ' + (row.username === accepted.username && row.email === accepted.email ? 'PASS' : 'FAIL'));
  console.log('  (c) fresh login by email                    : ' + (a1.data?.session ? 'PASS' : 'FAIL'));
  console.log('  (c) fresh login by auto-username            : ' + (a2.data?.session ? 'PASS' : 'FAIL'));
  console.log('  (d) admin rename succeeded                  : ' + (after.username === renamed ? 'PASS' : 'FAIL'));
  console.log('  (d) login by new username                   : ' + (a3.data?.session ? 'PASS' : 'FAIL'));
  console.log('  (d) login by email (still works)            : ' + (a4.data?.session ? 'PASS' : 'FAIL'));
  console.log('  (e) non-admin rename blocked                : ' + (block.error ? 'PASS' : 'FAIL'));
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
