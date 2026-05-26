/**
 * Reproduce Issue B: accept_invite succeeds but the immediate
 * signInWithPassword right after fails. Mirror the EXACT frontend
 * flow in _bare.invite.$token.tsx — anon client, accept then sign in.
 *
 * Mints a fresh single-use invite first (via service role) so we
 * don't burn the user's real test invites.
 */
import './loadEnv';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const ANON_KEY     = process.env.VITE_SUPABASE_ANON_KEY!;
const DB_URL       = process.env.DATABASE_URL!;

async function mintInviteForEmail(email: string | null): Promise<{ token: string; id: string }> {
  // Mint a fresh row directly in the DB. Bypasses the create_invite RPC
  // auth gate so we don't need an admin session. Same shape that
  // create_invite produces.
  const db = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    // Find an admin to be the creator (FK requirement).
    const { rows: [admin] } = await db.query<{ id: string }>(
      `select id from public.users where role='admin' and status='active' limit 1;`,
    );
    const tokenRow = await db.query<{ token: string; id: string }>(
      `insert into public.invites (token, role, board_id, group_id, created_by, expires_at, invitee_email)
       values (encode(extensions.gen_random_bytes(16),'hex'), 'manager', null, null, $1, null, $2)
       returning token, id;`,
      [admin.id, email],
    );
    return tokenRow.rows[0];
  } finally {
    await db.end();
  }
}

async function reproduce() {
  const email = 'diag-issueb-' + Date.now() + '@example.test';
  const username = 'diagb' + Math.floor(Math.random() * 100000);
  const password = 'DiagPass!12345';
  const fullName = 'Diag B Tester';

  console.log('---- Issue B reproduction ----');
  console.log('Inviting:           ' + email);
  console.log('Picked username:    ' + username);

  const minted = await mintInviteForEmail(email);
  console.log('Minted token:       ' + minted.token.slice(0, 12) + '...');

  // ---- mirror the frontend flow exactly ----
  const sb = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1) accept_invite (anon)
  console.log('\n[1] calling accept_invite (anon, current signature p_token/p_username/p_full_name/p_password) ...');
  const accept = await sb.rpc('accept_invite', {
    p_token:     minted.token,
    p_username:  username,
    p_full_name: fullName,
    p_password:  password,
  });
  if (accept.error) { console.log('   accept_invite ERROR: ' + accept.error.message); process.exit(1); }
  console.log('   accept_invite returned: ' + JSON.stringify(accept.data));

  // 2) immediate signInWithIdentifier(u, password) — what the page does today
  console.log('\n[2] mirror frontend: resolve_login_email(' + JSON.stringify(username) + ') then signInWithPassword');
  const resolve = await sb.rpc('resolve_login_email', { p_identifier: username });
  console.log('   resolve_login_email: ' + JSON.stringify(resolve.data) + (resolve.error ? '  ERR: ' + resolve.error.message : ''));

  const fallbackEmail = (resolve.data as string | null) ?? (username.includes('@') ? username : username + '@pms.internal');
  console.log('   email used for signInWithPassword: ' + fallbackEmail);

  const a = await sb.auth.signInWithPassword({ email: fallbackEmail, password });
  console.log('   signInWithPassword:');
  console.log('     ok? ' + (!!a.data?.session));
  if (a.error) console.log('     error: ' + a.error.message + ' (status=' + (a.error as any).status + ', code=' + (a.error as any).code + ')');

  // 3) ALSO try with the real email (the row's actual auth email)
  console.log('\n[3] sanity check: signInWithPassword using the REAL email');
  const sb2 = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const b = await sb2.auth.signInWithPassword({ email, password });
  console.log('   ok? ' + (!!b.data?.session));
  if (b.error) console.log('   error: ' + b.error.message);

  // 4) Try with synthetic email username@pms.internal too
  console.log('\n[4] also try synthetic username@pms.internal');
  const sb3 = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const c = await sb3.auth.signInWithPassword({ email: username + '@pms.internal', password });
  console.log('   ok? ' + (!!c.data?.session));
  if (c.error) console.log('   error: ' + c.error.message);

  console.log('\n---- end ----');
}
reproduce().catch((e) => { console.error('FAILED:', e); process.exit(1); });
