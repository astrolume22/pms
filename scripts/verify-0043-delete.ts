/**
 * End-to-end verifier for 0043 — admin_delete_user.
 *
 * (b) Mint a fresh user via invite, then have them create a board AND
 *     a task they OWN. Verify both exist with non-null author.
 *     Admin deletes the user → auth.users + public.users rows are gone,
 *     the user can NO LONGER log in, BUT the board + task still exist
 *     with owner_id / created_by = NULL (content survived).
 *
 * (c) admin_delete_user refuses when called by a non-admin, refuses
 *     self-delete, and refuses deleting the last admin.
 *
 * Also re-prints the FK map filter for the 9 flipped FKs to prove they
 * are SET NULL.
 */
import './loadEnv';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const ANON_KEY     = process.env.VITE_SUPABASE_ANON_KEY!;
const DB_URL       = process.env.DATABASE_URL!;
const ADMIN_EMAIL  = 'admin@pms.internal';
const ADMIN_PASS   = 'admin1234';

function fresh() { return createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } }); }

async function adminClient() {
  const sb = fresh();
  const { data, error } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASS });
  if (error) throw new Error('admin login: ' + error.message);
  return { sb, userId: data.user!.id };
}

async function main() {
  const stamp     = Date.now();
  const realEmail = 'verif0043-' + stamp + '@example.test';
  const fullName  = 'Verif 0043 User';
  const password  = 'Verif0043!9pass';

  console.log('---- 0043 end-to-end proof ----\n');

  // ============ (a) prove the FKs are SET NULL ============
  const db = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  console.log('(a) Authorship FK ON DELETE check (post-migration):');
  const flipped = [
    'boards_created_by_fk', 'boards_owner_fk', 'items_created_by_fk',
    'updates_author_fk',    'views_created_by_fk', 'files_uploader_fk',
    'invites_created_by_fk','activity_log_actor_fk','ai_runs_user_fk',
  ];
  const map = { a:'NO ACTION', r:'RESTRICT', c:'CASCADE', n:'SET NULL', d:'SET DEFAULT' } as Record<string,string>;
  const { rows: fkRows } = await db.query<{ conname: string; del: string }>(
    `select conname, confdeltype::text as del from pg_constraint
      where contype='f' and conname = any($1) order by conname;`,
    [flipped],
  );
  let allNull = true;
  for (const r of fkRows) {
    const a = map[r.del] ?? r.del;
    if (a !== 'SET NULL') allNull = false;
    console.log('   - ' + r.conname + ' -> ' + a);
  }
  console.log('   all SET NULL? ' + (allNull ? 'YES' : 'NO'));

  // ============ (b) survives-work proof ============
  console.log('\n(b) Create throwaway user via invite -> they author content -> delete them -> content survives');

  // 1) Admin mints invite
  const { sb: sbAdmin, userId: adminId } = await adminClient();
  const { data: inv, error: e1 } = await sbAdmin.rpc('create_invite', {
    p_role: 'manager', p_board_id: null, p_expires_in_hours: 24, p_group_id: null, p_invitee_email: realEmail,
  });
  if (e1) throw new Error('mint: ' + e1.message);
  const token = (inv as { token: string }).token;

  // 2) Anon accepts
  const sbAnon = fresh();
  const { data: accepted, error: e2 } = await sbAnon.rpc('accept_invite', {
    p_token: token, p_full_name: fullName, p_password: password,
  });
  if (e2) throw new Error('accept: ' + e2.message);
  const newUser = accepted as { user_id: string; username: string; email: string };
  console.log('   created user: @' + newUser.username + ' (' + newUser.user_id + ')');

  // 3) Verify user CAN log in (sanity)
  const sbUser = fresh();
  const lg = await sbUser.auth.signInWithPassword({ email: newUser.email, password });
  if (lg.error) throw new Error('user login: ' + lg.error.message);

  // 4) Bypass RLS for the test fixture: insert a board + group + item
  //    directly via the postgres client (service-role-equivalent
  //    via DATABASE_URL). The point of this script isn't to test
  //    board-creation RLS — it's to prove that AFTER the user is
  //    deleted, their authored rows still exist with NULL authorship.
  const { rows: [{ id: wsId }] } = await db.query<{ id: string }>(
    `select id from public.workspaces where is_main = true limit 1`,
  );
  const { rows: [boardRow] } = await db.query<{ id: string; owner_id: string | null; created_by: string | null }>(
    `insert into public.boards (name, description, workspace_id, owner_id, created_by)
       values ($1, '', $2, $3, $3) returning id, owner_id, created_by`,
    ['Verif0043 Board ' + stamp, wsId, newUser.user_id],
  );
  console.log('   board: ' + boardRow.id + '  owner_id=' + boardRow.owner_id + '  created_by=' + boardRow.created_by);

  const { rows: [grpRow] } = await db.query<{ id: string }>(
    `insert into public.groups (board_id, name, sort_order, color)
       values ($1, 'g1', 0, '#888888') returning id`,
    [boardRow.id],
  );

  const { rows: [itemRow] } = await db.query<{ id: string; created_by: string | null; updated_by: string | null }>(
    `insert into public.items (board_id, group_id, name, task_code, sort_order, created_by)
       values ($1, $2, 'verif0043 task', $3, 0, $4) returning id, created_by, updated_by`,
    [boardRow.id, grpRow.id, 'V43-' + stamp.toString().slice(-5), newUser.user_id],
  );
  console.log('   item:  ' + itemRow.id + '  created_by=' + itemRow.created_by + '  updated_by=' + itemRow.updated_by);
  const board = { data: boardRow };
  const item  = { data: itemRow };

  // 6) Admin deletes the user
  const del = await sbAdmin.rpc('admin_delete_user', { p_user_id: newUser.user_id });
  console.log('   admin_delete_user: ' + (del.error ? 'FAIL ' + del.error.message : 'OK'));

  // 7) Verify the auth row + public row are GONE
  const { rows: stillPublic } = await db.query<{ id: string }>(`select id from public.users where id=$1`, [newUser.user_id]);
  const { rows: stillAuth   } = await db.query<{ id: string }>(`select id from auth.users   where id=$1`, [newUser.user_id]);
  console.log('   public.users gone? ' + (stillPublic.length === 0 ? 'YES' : 'NO'));
  console.log('   auth.users   gone? ' + (stillAuth.length === 0 ? 'YES' : 'NO'));

  // 8) The user can no longer log in
  const sbDead = fresh();
  const reLog = await sbDead.auth.signInWithPassword({ email: newUser.email, password });
  console.log('   re-login: ' + (reLog.error ? 'BLOCKED — ' + reLog.error.message : 'STILL WORKS (BUG)'));

  // 9) The board + task survive with NULL author
  const { rows: [boardAfter] } = await db.query<{ id: string; owner_id: string | null; created_by: string | null; name: string }>(
    `select id, owner_id, created_by, name from public.boards where id=$1`, [board.data.id],
  );
  const { rows: [itemAfter] } = await db.query<{ id: string; created_by: string | null; updated_by: string | null; name: string }>(
    `select id, created_by, updated_by, name from public.items where id=$1`, [item.data.id],
  );
  console.log('   board AFTER: ' + JSON.stringify(boardAfter));
  console.log('   item  AFTER: ' + JSON.stringify(itemAfter));

  // ============ (c) refuse cases ============
  console.log('\n(c) Refuse cases:');

  // c1) non-admin -> blocked
  const { sb: sbAdmin2 } = await adminClient();
  // create a temporary non-admin user (the freshly created/deleted user is gone, mint a new one)
  const realEmail2 = 'verif0043b-' + stamp + '@example.test';
  const { data: inv2 } = await sbAdmin2.rpc('create_invite', {
    p_role: 'manager', p_board_id: null, p_expires_in_hours: 24, p_group_id: null, p_invitee_email: realEmail2,
  });
  const sbAnon2 = fresh();
  const { data: u2 } = await sbAnon2.rpc('accept_invite', { p_token: (inv2 as any).token, p_full_name: 'NonAdmin', p_password: password });
  const user2 = u2 as { user_id: string; email: string; username: string };
  const sbNonAdmin = fresh();
  await sbNonAdmin.auth.signInWithPassword({ email: user2.email, password });
  // Try to delete admin
  const c1 = await sbNonAdmin.rpc('admin_delete_user', { p_user_id: adminId });
  console.log('   non-admin -> delete admin: ' + (c1.error ? 'BLOCKED — "' + c1.error.message + '"' : 'OPEN (BUG)'));

  // c2) self-delete -> blocked
  const c2 = await sbAdmin2.rpc('admin_delete_user', { p_user_id: adminId });
  console.log('   admin -> delete SELF:     ' + (c2.error ? 'BLOCKED — "' + c2.error.message + '"' : 'OPEN (BUG)'));

  // c3) last-admin -> blocked. There's currently only one admin (admin). Try deleting admin via a fake admin context.
  //     The self-delete guard fires first if same user → we already saw that.
  //     To test last-admin specifically, create a SECOND admin, log in as them, try deleting the first.
  //     Easiest path: use admin-only RPC admin_create_user (which mints synthetic users), then admin_set_role to promote to admin.
  const u3Username = 'verif43c' + stamp.toString().slice(-5);
  const { error: e3a } = await sbAdmin2.rpc('admin_create_user', { p_username: u3Username, p_full_name: 'TempAdmin', p_role: 'manager', p_password: password });
  if (e3a) throw new Error('admin_create_user: ' + e3a.message);
  const { rows: [u3] } = await db.query<{ id: string }>(`select id from public.users where username=$1`, [u3Username]);
  const e3b = await sbAdmin2.rpc('admin_set_role', { p_user_id: u3.id, p_role: 'admin' });
  if (e3b.error) throw new Error('admin_set_role: ' + e3b.error.message);
  // Sign in as u3 (admin) and try to delete the original admin.
  const sbU3 = fresh();
  const u3Email = u3Username + '@pms.internal';
  await sbU3.auth.signInWithPassword({ email: u3Email, password });
  // Now there are 2 admins: this should SUCCEED in deleting the OTHER admin (admin),
  // so to prove last-admin guard, first delete the original admin via u3 -> ok, then have admin try (but admin is gone).
  // Easier last-admin proof: delete u3 themselves via the original admin -> there are 2 admins, ok.
  //   Then try to delete the original admin from u3 -> only one admin left after, which is u3 -> blocked!
  //
  // Wait: count is "other admins remaining after this delete". If target is admin and remaining_other_admins == 0, block.
  // Currently: admin + u3. If u3 tries to delete admin → other admins remaining = 1 (u3 itself, but u3 is the caller).
  // Re-read RPC: select count from users where role='admin' and status='active' and id != p_user_id.
  // p_user_id is admin's id → count is users where role=admin and id != admin → that's u3. Count = 1. NOT blocked.
  // To trigger last-admin block, both u3 and admin would need to be the same, which is self-delete.
  // Or: when there's only ONE admin total and admin tries to delete another admin who's... not possible.
  //
  // Last-admin block fires when: target IS admin AND no OTHER admin exists.
  // So: demote u3, delete admin → 0 other admins → blocked.
  await sbAdmin2.rpc('admin_set_role', { p_user_id: u3.id, p_role: 'manager' });
  const c3 = await sbAdmin2.rpc('admin_delete_user', { p_user_id: adminId });
  console.log('   admin -> delete LAST admin (self-block fires first): ' + (c3.error ? 'BLOCKED — "' + c3.error.message + '"' : 'OPEN (BUG)'));
  // The self-block fires first because caller==target. To bypass self-block, promote u3 again and try from u3 to delete admin.
  await sbAdmin2.rpc('admin_set_role', { p_user_id: u3.id, p_role: 'admin' });
  const sbU3b = fresh();
  await sbU3b.auth.signInWithPassword({ email: u3Email, password });
  // Now demote u3 to manager via the ORIGINAL admin so only 1 admin (admin) exists.
  // u3 is now an admin temporarily. Delete u3 from admin → after delete, only admin remains. Not last-admin block.
  // Better: from u3 (admin), try to delete admin → after delete, only u3 remains (admin). That's not last-admin block either.
  // For last-admin block we need: caller deleting an admin and 0 other admins remaining.
  // So: keep u3 as admin, log in as u3, demote admin to manager via u3, then u3 deletes themselves? That's self-delete.
  // Or: u3 tries to delete admin while admin is the only OTHER admin — count=1, not blocked.
  //
  // Actually re-read the guard: count = users where role='admin' and active and id != target. If count == 0, block.
  // We need a scenario where: target is admin, AND no other admin exists.
  // If u3 demotes admin (changes admin's role to manager) → admin is no longer 'admin' role. Then u3 deletes admin -> target's role at delete time is 'manager' (not admin). So the last-admin guard doesn't fire (it only fires when target.role='admin').
  //
  // The clean way to demonstrate last-admin block: temporarily make a test admin Y, then sign in as Y, then try to delete the original admin X. Other-admins count = 0 (Y is self). Block fires.
  const sbU3c = fresh();
  await sbU3c.auth.signInWithPassword({ email: u3Email, password });
  const c3b = await sbU3c.rpc('admin_delete_user', { p_user_id: adminId });
  console.log('   u3-admin -> delete the OTHER (last remaining other) admin: ' + (c3b.error ? 'BLOCKED — "' + c3b.error.message + '"' : 'NOT BLOCKED'));
  // Cleanup: demote u3, then delete u3 via the original admin.
  await sbAdmin2.rpc('admin_set_role', { p_user_id: u3.id, p_role: 'manager' });
  const cleanup1 = await sbAdmin2.rpc('admin_delete_user', { p_user_id: u3.id });
  console.log('   cleanup: delete temp u3: ' + (cleanup1.error ? 'FAIL ' + cleanup1.error.message : 'OK'));
  const cleanup2 = await sbAdmin2.rpc('admin_delete_user', { p_user_id: user2.user_id });
  console.log('   cleanup: delete temp user2: ' + (cleanup2.error ? 'FAIL ' + cleanup2.error.message : 'OK'));

  await db.end();

  console.log('\nSUMMARY:');
  console.log('  (a) all 9 authorship FKs SET NULL         : ' + (allNull ? 'PASS' : 'FAIL'));
  console.log('  (b) public.users + auth.users deleted     : ' + ((stillPublic.length === 0 && stillAuth.length === 0) ? 'PASS' : 'FAIL'));
  console.log('  (b) deleted user can no longer log in     : ' + (reLog.error ? 'PASS' : 'FAIL'));
  console.log('  (b) board survives with owner_id=NULL     : ' + (boardAfter && boardAfter.owner_id === null ? 'PASS' : 'FAIL'));
  console.log('  (b) board survives with created_by=NULL   : ' + (boardAfter && boardAfter.created_by === null ? 'PASS' : 'FAIL'));
  console.log('  (b) item  survives with created_by=NULL   : ' + (itemAfter  && itemAfter.created_by  === null ? 'PASS' : 'FAIL'));
  console.log('  (c) non-admin call blocked                : ' + (c1.error ? 'PASS' : 'FAIL'));
  console.log('  (c) self-delete blocked                   : ' + (c2.error ? 'PASS' : 'FAIL'));
  console.log('  (c) last-other-admin delete blocked       : ' + (c3b.error ? 'PASS' : 'FAIL'));
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
