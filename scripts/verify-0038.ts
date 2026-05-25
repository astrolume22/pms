/**
 * Verify migration 0038 — bulk soft-delete works for admin AND tenant
 * isolation is intact for managers.
 *
 *   1. Admin signs in via JWT.
 *      - Inserts 2 throw-away items on the Tessera board.
 *      - Shows their items.deleted_at IS NULL (raw DB).
 *      - Soft-deletes BOTH via `.update({ deleted_at }).in('id', [...])`
 *        (the exact useBulkItemAction call).
 *      - Shows items.deleted_at is now a timestamp (raw DB).
 *      - Confirms the items DISAPPEAR from useBoardItems' equivalent
 *        query (admin-JWT SELECT with `.is('deleted_at', null)`) and
 *        STAY gone after a re-fetch.
 *      - Confirms `is_admin()` UPDATE policy still works for non-
 *        delete columns (archive / rename / name change).
 *
 *   2. Manager pm1 signs in via JWT.
 *      - Hard-create a fresh test board X that pm1 is NOT subscribed
 *        to. Insert an item on it.
 *      - pm1 attempts to soft-delete that item → must FAIL or affect
 *        zero rows (tenant isolation intact — items_update USING is
 *        is_admin() so pm1 simply doesn't match).
 *      - Subscribe pm1 to a different board (the Tessera board), give
 *        them group_id=null (whole-board access). pm1 attempts to
 *        soft-delete an item on the Tessera board → must STILL fail
 *        because items_update USING is is_admin() (RLS unchanged).
 *      - Confirm pm1 can still SELECT the items they're allowed to
 *        (subscriber visibility unchanged).
 *
 * Cleans up every fixture row at the end (hard delete via service
 * role).
 */
import './loadEnv';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

const url        = process.env.VITE_SUPABASE_URL!;
const anonKey    = process.env.VITE_SUPABASE_ANON_KEY!;
const adminUser  = process.env.MASTER_ADMIN_USERNAME!;
const adminPw    = process.env.MASTER_ADMIN_PASSWORD!;
const INTERNAL_DOMAIN = 'pms.internal';

const TESSERA_BOARD = '9c3afa37-e5f0-4e19-9ea5-e664d5070566';

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
  const pg = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await pg.connect();
  const cleanupIds: string[] = [];
  const cleanupBoards: string[] = [];

  try {
    // ====== 1. ADMIN ======
    console.log('\n=== ADMIN: bulk soft-delete via JWT ===');
    const admin = await signIn(`${adminUser}@${INTERNAL_DOMAIN}`, adminPw);
    console.log(`  admin signed in: ${admin.userId}`);

    const { rows: [g] } = await pg.query(
      `select id from public.groups where board_id = $1 order by sort_order limit 1;`,
      [TESSERA_BOARD]
    );
    const { rows: items1 } = await pg.query(
      `insert into public.items (board_id, group_id, name, task_code, created_by)
         values ($1, $2, 'VERIFY-0038-A', 'v38-' || floor(random()*1000000)::text, $3),
                ($1, $2, 'VERIFY-0038-B', 'v38-' || floor(random()*1000000)::text, $3)
       returning id, name, deleted_at;`,
      [TESSERA_BOARD, g.id, admin.userId]
    );
    cleanupIds.push(...items1.map((i) => i.id));
    const ids = items1.map((i) => i.id);
    console.log(`  fixture items: ${ids.map((i) => i.slice(0, 8)).join(', ')}`);
    console.log(`  BEFORE deleted_at: ${items1.map((i) => i.deleted_at).join(', ')}`);
    expect('BEFORE — both items have deleted_at = NULL', items1.every((i) => i.deleted_at === null));

    // Exact useBulkItemAction call
    const now = new Date().toISOString();
    const { error: dErr, status: dStatus } = await admin.client
      .from('items')
      .update({ deleted_at: now } as never)
      .in('id', ids);
    expect(`admin bulk soft-delete returned no error (got status=${dStatus})`, !dErr,
      `error=${dErr?.message} code=${dErr?.code}`);

    const { rows: items2 } = await pg.query(
      `select id, deleted_at from public.items where id = any($1::uuid[]) order by name;`,
      [ids]
    );
    console.log(`  AFTER  deleted_at: ${items2.map((i) => i.deleted_at).join(', ')}`);
    expect('AFTER — both items have a non-null deleted_at timestamp', items2.every((i) => i.deleted_at !== null));

    // useBoardItems-equivalent SELECT — should NOT return soft-deleted rows
    const { data: visible } = await admin.client
      .from('items')
      .select('id, name')
      .eq('board_id', TESSERA_BOARD)
      .is('deleted_at', null)
      .in('id', ids);
    expect('admin board query (.is deleted_at null) hides soft-deleted rows',
      !visible || visible.length === 0,
      `unexpectedly visible=${JSON.stringify(visible)}`);

    // Re-fetch (simulating react-query invalidation) — still gone
    const { data: visible2 } = await admin.client
      .from('items')
      .select('id, name')
      .eq('board_id', TESSERA_BOARD)
      .is('deleted_at', null)
      .in('id', ids);
    expect('re-fetch still excludes them (no resurrection)', !visible2 || visible2.length === 0);

    // Sanity: non-delete UPDATEs still work (archive + rename)
    // Create another fixture
    const { rows: [renameItem] } = await pg.query(
      `insert into public.items (board_id, group_id, name, task_code, created_by)
         values ($1, $2, 'VERIFY-0038-RENAME', 'v38r-' || floor(random()*1000000)::text, $3)
         returning id;`, [TESSERA_BOARD, g.id, admin.userId]
    );
    cleanupIds.push(renameItem.id);
    const { error: renErr } = await admin.client
      .from('items').update({ name: 'VERIFY-0038-RENAMED' } as never).eq('id', renameItem.id);
    expect('admin rename UPDATE still works (non-delete write path)', !renErr,
      `error=${renErr?.message}`);
    const { error: archErr } = await admin.client
      .from('items').update({ archived_at: now } as never).eq('id', renameItem.id);
    expect('admin archive UPDATE still works', !archErr, `error=${archErr?.message}`);

    // ====== 2. MANAGER pm1 ======
    console.log('\n=== MANAGER pm1: isolation intact ===');
    const pm1 = await signIn('pm1@pms.internal', 'project123!');
    console.log(`  pm1 signed in: ${pm1.userId}`);

    // Make a fresh board X that pm1 is NOT subscribed to.
    const { rows: [wsRow] } = await pg.query(`select id from public.workspaces where is_main = true limit 1;`);
    const { rows: [boardX] } = await pg.query(
      `insert into public.boards (workspace_id, name, owner_id, created_by, board_type)
         values ($1, 'VERIFY-0038-not-subscribed', $2, $2, 'main')
         returning id;`,
      [wsRow.id, admin.userId]
    );
    cleanupBoards.push(boardX.id);
    // The after_board_insert trigger creates a default group on this new board.
    const { rows: [gX] } = await pg.query(
      `select id from public.groups where board_id = $1 limit 1;`, [boardX.id]
    );
    const { rows: [iX] } = await pg.query(
      `insert into public.items (board_id, group_id, name, task_code, created_by)
         values ($1, $2, 'pm1-cannot-touch-me', 'isolate-' || floor(random()*1000000)::text, $3)
         returning id;`,
      [boardX.id, gX.id, admin.userId]
    );
    cleanupIds.push(iX.id);

    // pm1 attempts to soft-delete on a board they CANNOT see.
    // items_update USING is is_admin() → pm1 returns false → row not
    // visible to UPDATE → zero rows affected, no error (PostgREST 204).
    // Row stays untouched. That's the right isolation behaviour.
    const { error: pm1XErr } = await pm1.client
      .from('items').update({ deleted_at: now } as never).in('id', [iX.id]);
    const { rows: [iXafter] } = await pg.query(
      `select deleted_at from public.items where id = $1;`, [iX.id]
    );
    expect('pm1 cannot soft-delete an item on a board they are not subscribed to (row untouched)',
      iXafter.deleted_at === null,
      `pm1Err=${pm1XErr?.message} deleted_at=${iXafter.deleted_at}`);

    // pm1 attempts to soft-delete on Tessera even after subscribing.
    // items_update USING is is_admin() → STILL false for pm1 → no
    // change. This proves the admin-only write gate didn't widen.
    await pg.query(
      `insert into public.board_subscribers (board_id, user_id, role, group_id)
         values ($1, $2, 'member', null) on conflict do nothing;`,
      [TESSERA_BOARD, pm1.userId]
    );
    const { rows: [tess] } = await pg.query(
      `insert into public.items (board_id, group_id, name, task_code, created_by)
         values ($1, $2, 'pm1-also-cannot-touch', 'isolate2-' || floor(random()*1000000)::text, $3)
         returning id;`,
      [TESSERA_BOARD, g.id, admin.userId]
    );
    cleanupIds.push(tess.id);
    const { error: pm1TessErr } = await pm1.client
      .from('items').update({ deleted_at: now } as never).in('id', [tess.id]);
    const { rows: [tessAfter] } = await pg.query(
      `select deleted_at from public.items where id = $1;`, [tess.id]
    );
    expect('pm1 (subscriber, NOT admin) still cannot soft-delete (items_update gate is admin-only)',
      tessAfter.deleted_at === null,
      `pm1Err=${pm1TessErr?.message} deleted_at=${tessAfter.deleted_at}`);

    // pm1 CAN still SELECT items they're allowed to (subscriber).
    const { data: pm1Sees } = await pm1.client
      .from('items').select('id').eq('board_id', TESSERA_BOARD).is('deleted_at', null).limit(1);
    expect('pm1 can SELECT items on a subscribed board (SELECT path unchanged)',
      !!pm1Sees && pm1Sees.length > 0, `data=${JSON.stringify(pm1Sees)}`);

  } finally {
    // Cleanup
    if (cleanupIds.length) {
      await pg.query(`delete from public.items where id = any($1::uuid[]);`, [cleanupIds]);
    }
    if (cleanupBoards.length) {
      await pg.query(`delete from public.boards where id = any($1::uuid[]);`, [cleanupBoards]);
    }
    // Unsubscribe pm1 from Tessera (was a fixture)
    const { rows: [pm1Row] } = await pg.query(`select id from public.users where username = 'pm1';`);
    if (pm1Row) {
      await pg.query(
        `delete from public.board_subscribers where board_id = $1 and user_id = $2 and group_id is null;`,
        [TESSERA_BOARD, pm1Row.id]
      );
    }
    await pg.end();
  }

  console.log('');
  if (failures > 0) {
    console.error(`❌ ${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('✅ All checks passed — soft-delete works, isolation intact.');
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
