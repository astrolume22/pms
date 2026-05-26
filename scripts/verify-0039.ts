/**
 * Verify migration 0039 — create_invite accepts admin / manager /
 * viewer, but ONLY admins can mint. Plus end-to-end: accept a viewer
 * invite and confirm the new user lands as
 * board_subscribers.role = 'viewer' (read-only).
 *
 * Touches no existing data — every fixture (board, item, accepted
 * user) is created fresh and torn down at the end.
 */
import './loadEnv';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

const url        = process.env.VITE_SUPABASE_URL!;
const anonKey    = process.env.VITE_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const adminUser  = process.env.MASTER_ADMIN_USERNAME!;
const adminPw    = process.env.MASTER_ADMIN_PASSWORD!;
const INTERNAL_DOMAIN = 'pms.internal';

let failures = 0;
const expect = (label: string, cond: boolean, detail?: string) => {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
};

async function signIn(email: string, pw: string) {
  const cli = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await cli.auth.signInWithPassword({ email, password: pw });
  if (error || !data.session) throw new Error(`sign-in failed for ${email}: ${error?.message}`);
  return {
    userId: data.user!.id,
    jwt: data.session.access_token,
    client: createClient(url, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
    }),
  };
}

async function main() {
  const pg  = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  const svc = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  await pg.connect();
  const cleanup: { invites: string[]; users: string[]; authUsers: string[]; boards: string[] } = {
    invites: [], users: [], authUsers: [], boards: [],
  };

  try {
    // ============ 1. ADMIN — mint all 3 roles ============
    console.log('\n=== ADMIN: mint admin / manager / viewer ===');
    const admin = await signIn(`${adminUser}@${INTERNAL_DOMAIN}`, adminPw);
    console.log(`  admin signed in: ${admin.userId}`);

    const mint = async (role: 'admin' | 'manager' | 'viewer') => {
      const { data, error } = await admin.client.rpc('create_invite', {
        p_role: role,
        p_board_id: null,
        p_expires_in_hours: 24,
        p_group_id: null,
      });
      return { data: data as { id: string; token: string; role: string } | null, error };
    };

    for (const role of ['admin', 'manager', 'viewer'] as const) {
      const { data, error } = await mint(role);
      const ok = !error && !!data;
      expect(`admin mints role='${role}' — RPC returns ok`, ok, `error=${error?.message} code=${error?.code}`);
      if (ok && data) {
        cleanup.invites.push(data.id);
        // Verify the row in the DB carries the actual role.
        const { rows: [row] } = await pg.query<{ role: string }>(
          `select role from public.invites where id = $1;`, [data.id]
        );
        expect(`  → DB row role = '${role}'`, row?.role === role,
          `actual='${row?.role}' returned='${data.role}'`);
        expect(`  → RPC returned role = '${role}' (not hardcoded 'manager')`,
          data.role === role, `returned='${data.role}'`);
      }
    }

    // Invalid role should 22023.
    const { error: badErr } = await admin.client.rpc('create_invite', {
      p_role: 'super_admin',
      p_board_id: null,
      p_expires_in_hours: 24,
      p_group_id: null,
    });
    expect('admin mints role="super_admin" → 22023 invalid-role error',
      badErr?.code === '22023',
      `code=${badErr?.code} msg=${badErr?.message}`);

    // ============ 2. MANAGER pm1 — STILL blocked ============
    console.log('\n=== MANAGER pm1: still blocked from minting ===');
    const pm1 = await signIn('pm1@pms.internal', 'project123!');
    console.log(`  pm1 signed in: ${pm1.userId}`);

    for (const role of ['admin', 'manager', 'viewer'] as const) {
      const { error } = await pm1.client.rpc('create_invite', {
        p_role: role,
        p_board_id: null,
        p_expires_in_hours: 24,
        p_group_id: null,
      });
      // 42501 from is_admin() gate. PostgREST may surface RAISE as a
      // generic auth error too — accept either is_admin() refusal.
      const blocked = !!error && (error.code === '42501' || /only admins/i.test(error.message ?? ''));
      expect(`pm1 mints role='${role}' → BLOCKED`, blocked,
        `error.code=${error?.code} msg=${error?.message}`);
    }

    // ============ 3. END-TO-END — accept a viewer invite ============
    console.log('\n=== E2E: accept viewer invite → board_subscribers.role=viewer ===');
    // Make a fresh test board to invite into.
    const { rows: [ws] } = await pg.query(`select id from public.workspaces where is_main = true limit 1;`);
    const { rows: [testBoard] } = await pg.query(
      `insert into public.boards (workspace_id, name, owner_id, created_by, board_type)
         values ($1, 'VERIFY-0039-viewer-e2e', $2, $2, 'main')
         returning id;`,
      [ws.id, admin.userId]
    );
    cleanup.boards.push(testBoard.id);
    console.log(`  test board: ${testBoard.id}`);

    // Admin mints a viewer invite scoped to this board.
    const { data: vInv, error: vErr } = await admin.client.rpc('create_invite', {
      p_role: 'viewer',
      p_board_id: testBoard.id,
      p_expires_in_hours: 1,
      p_group_id: null,
    });
    expect('admin mints VIEWER invite scoped to test board', !vErr && !!vInv,
      `error=${vErr?.message}`);
    if (!vInv) throw new Error('viewer invite was not created — abort');
    const vToken = (vInv as { token: string; id: string }).token;
    cleanup.invites.push((vInv as { id: string }).id);

    // Use an anon client to accept it (the accept page is unauthed).
    const anonCli = createClient(url, anonKey, { auth: { persistSession: false } });
    const inviteeUser = 'verify0039_v_' + Math.random().toString(36).slice(2, 8);
    const inviteePw   = 'project9999!';
    const { data: accepted, error: aErr } = await anonCli.rpc('accept_invite', {
      p_token:     vToken,
      p_username:  inviteeUser,
      p_full_name: 'Verify 0039 Viewer',
      p_password:  inviteePw,
    });
    expect('anon caller can accept_invite() with the viewer token', !aErr && !!accepted,
      `error=${aErr?.message}`);
    const acceptedRow = accepted as { user_id: string } | null;
    if (acceptedRow?.user_id) {
      cleanup.users.push(acceptedRow.user_id);
      cleanup.authUsers.push(acceptedRow.user_id);
    }

    // Check the public.users row's role.
    const { rows: [pubUser] } = await pg.query<{ role: string; username: string }>(
      `select role, username from public.users where id = $1;`,
      [acceptedRow!.user_id]
    );
    expect('public.users.role = viewer', pubUser?.role === 'viewer',
      `actual='${pubUser?.role}' username='${pubUser?.username}'`);

    // Check board_subscribers — viewer should land with role='viewer'.
    const { rows: [sub] } = await pg.query<{ role: string }>(
      `select role from public.board_subscribers where board_id = $1 and user_id = $2;`,
      [testBoard.id, acceptedRow!.user_id]
    );
    expect('board_subscribers.role = viewer (NOT member)',
      sub?.role === 'viewer', `actual='${sub?.role}'`);

    // Sanity: the viewer can SELECT items on the board (read access).
    // First we need to insert an item so there's something to see.
    const { rows: [tg] } = await pg.query(
      `select id from public.groups where board_id = $1 limit 1;`, [testBoard.id]
    );
    if (tg) {
      const { rows: [seedItem] } = await pg.query(
        `insert into public.items (board_id, group_id, name, task_code, created_by)
           values ($1, $2, 'viewer-can-see-this', 'view-' || floor(random()*1000000)::text, $3)
           returning id;`,
        [testBoard.id, tg.id, admin.userId]
      );
      // sign the viewer in.
      const viewerSession = await signIn(`${inviteeUser}@${INTERNAL_DOMAIN}`, inviteePw);
      const { data: visible } = await viewerSession.client
        .from('items').select('id, name').eq('id', seedItem.id);
      expect('viewer CAN read items on the board (subscriber visibility)',
        Array.isArray(visible) && visible.length === 1,
        `data=${JSON.stringify(visible)}`);
      // Viewer must NOT be able to UPDATE items (items_update USING = is_admin()).
      const { data: upd, error: uErr } = await viewerSession.client
        .from('items').update({ name: 'viewer-tried-to-write' }).eq('id', seedItem.id).select('id');
      const wasBlocked = !!uErr || (Array.isArray(upd) && upd.length === 0);
      expect('viewer CANNOT write items (read-only enforced by RLS)', wasBlocked,
        `error=${uErr?.message} upd=${JSON.stringify(upd)}`);
    }
  } finally {
    // Cleanup
    if (cleanup.invites.length) {
      await pg.query(`delete from public.invites where id = any($1::uuid[]);`, [cleanup.invites]);
    }
    if (cleanup.boards.length) {
      await pg.query(`delete from public.boards where id = any($1::uuid[]);`, [cleanup.boards]);
    }
    // public.users + workspace_members cascade via the user delete.
    if (cleanup.users.length) {
      await pg.query(`delete from public.users where id = any($1::uuid[]);`, [cleanup.users]);
    }
    // auth.users — must use admin API.
    for (const uid of cleanup.authUsers) {
      await svc.auth.admin.deleteUser(uid).catch(() => undefined);
    }
    await pg.end();
  }

  console.log('');
  if (failures > 0) {
    console.error(`❌ ${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('✅ 0039 verified end-to-end.');
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
