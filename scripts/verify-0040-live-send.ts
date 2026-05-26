/**
 * Hit the DEPLOYED /api/send-invite-email route end-to-end.
 *
 *   1. Sign in as admin via Supabase Auth (real JWT).
 *   2. Mint a fresh invite with create_invite() + p_invitee_email
 *      pointing at delivered@resend.dev (Resend's test recipient
 *      that ACCEPTS sends without bouncing to a real inbox and
 *      returns a real id).
 *   3. POST to /api/send-invite-email on the live Vercel URL with
 *      the Bearer JWT + body { token, invitee_email, board_name,
 *      role, inviter_name }.
 *   4. Print the response. Success = { sent: true, id: <uuid> }.
 *   5. Clean up the invite row.
 */
import './loadEnv';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

const url       = process.env.VITE_SUPABASE_URL!;
const anonKey   = process.env.VITE_SUPABASE_ANON_KEY!;
const adminUser = process.env.MASTER_ADMIN_USERNAME!;
const adminPw   = process.env.MASTER_ADMIN_PASSWORD!;
const BASE_URL  = process.argv[2] || 'https://pms-snowy-eight.vercel.app';

async function main() {
  const cli = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data: si, error: sErr } = await cli.auth.signInWithPassword({
    email: `${adminUser}@pms.internal`, password: adminPw,
  });
  if (sErr || !si.session) { console.error('sign-in failed:', sErr); process.exit(1); }
  const jwt = si.session.access_token;
  console.log(`admin signed in: ${si.user!.id}`);

  // Create an invite via the RPC (with invitee_email).
  const adminCli = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: inv, error: invErr } = await adminCli.rpc('create_invite', {
    p_role: 'viewer',
    p_board_id: null,
    p_expires_in_hours: 1,
    p_group_id: null,
    p_invitee_email: 'delivered@resend.dev',
  });
  if (invErr || !inv) { console.error('mint failed:', invErr); process.exit(1); }
  const invite = inv as { id: string; token: string };
  console.log(`invite minted: id=${invite.id} token=${invite.token.slice(0, 8)}…`);

  // POST to the deployed route.
  console.log(`POST ${BASE_URL}/api/send-invite-email`);
  const resp = await fetch(`${BASE_URL}/api/send-invite-email`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type':  'application/json',
      'Origin':        BASE_URL,
    },
    body: JSON.stringify({
      token:         invite.token,
      invitee_email: 'delivered@resend.dev',
      board_name:    'Team Projects (Tessera)',
      role:          'viewer',
      inviter_name:  'Master Admin',
    }),
  });
  const body = await resp.json().catch(() => null);
  console.log(`status: ${resp.status} ${resp.statusText}`);
  console.log(`body:   ${JSON.stringify(body, null, 2)}`);

  // Clean up the invite (still pending — we never accepted it).
  const pg = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await pg.connect();
  await pg.query(`delete from public.invites where id = $1;`, [invite.id]);
  await pg.end();
  console.log(`cleanup: invite deleted`);

  if (!resp.ok || !(body && (body as { sent?: boolean }).sent)) {
    console.error('\n❌ send did NOT succeed');
    process.exit(1);
  }
  console.log('\n✅ Resend POST succeeded end-to-end via the live Vercel route.');
}
main().catch((e) => { console.error(e); process.exit(1); });
