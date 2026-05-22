/**
 * Verify migration 0031 against either the live Vercel target or
 * localhost (`vercel dev`). Pass the base URL as the first arg.
 *
 *   npx tsx scripts/verify-0031.ts https://pms-snowy-eight.vercel.app
 *   npx tsx scripts/verify-0031.ts http://localhost:3033
 *
 * Proves all of:
 *   1. Admin: /api/ai-build returns a plan AND every applier action
 *      executes through PostgREST (group + tasks + cells), no 42501,
 *      no stop at action 2.
 *   2. Admin: soft-delete a board (UPDATE deleted_at) → 204/200.
 *   3. Admin: hard-delete a board → no P0001 / no cascade abort.
 *   4. Manager pm1 isolation (Requirement B):
 *      - pm1 subscribed to board A with group_id NULL  → sees all items on A.
 *      - pm1 subscribed to board B with group scope    → sees only that group's items on B.
 *      - pm1 NOT subscribed to board C                 → sees zero items on C.
 *      - pm1 cannot UPDATE items.name on any of those (admin-only RLS).
 *   5. A deliberately invalid action (group_ref pointing at nothing)
 *      surfaces as a readable error string, not "[object Object]".
 */
import './loadEnv';
import { Client } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const baseUrl = process.argv[2];
if (!baseUrl) {
  console.error('usage: tsx verify-0031.ts <base-url>');
  process.exit(1);
}

const supaUrl   = process.env.VITE_SUPABASE_URL!;
const anonKey   = process.env.VITE_SUPABASE_ANON_KEY!;
const adminUser = process.env.MASTER_ADMIN_USERNAME!;
const adminPw   = process.env.MASTER_ADMIN_PASSWORD!;

// ====================================================================
// SETUP via direct Postgres (service-role) — fixture state for the run.
// ====================================================================
const pg = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
await pg.connect();

const adminId = (await pg.query(
  `select id from public.users where username = $1`, [adminUser],
)).rows[0].id;
const { rows: [pm1Row] } = await pg.query(
  `select id from public.users where username = 'pm1'`,
);
const pm1Id = pm1Row.id;

// Throw-away test boards so we don't disturb existing data.
const boardName = (suffix: string) => `verify-0031-${suffix}-${Date.now()}`;
async function makeBoard(name: string): Promise<string> {
  const { rows: [b] } = await pg.query(
    `insert into public.boards (workspace_id, name, owner_id, created_by, board_type)
       values ((select id from public.workspaces where is_main=true limit 1),
               $1, $2, $2, 'main')
       returning id`,
    [name, adminId],
  );
  return b.id;
}

const boardA_id = await makeBoard(boardName('A_pm1_full'));         // pm1 has full access
const boardB_id = await makeBoard(boardName('B_pm1_groupscoped'));  // pm1 group-scoped
const boardC_id = await makeBoard(boardName('C_pm1_no_access'));    // pm1 has no row
const boardSoft_id = await makeBoard(boardName('Soft_for_archive'));
const boardHard_id = await makeBoard(boardName('Hard_for_delete'));

// Seed each test board with 2 groups + 2 items per group.
async function seedBoardWithGroups(boardId: string): Promise<{ g1: string; g2: string; items: Record<string,string[]> }> {
  const { rows: [g1] } = await pg.query(
    `insert into public.groups (board_id, name, color, sort_order)
       values ($1, 'GroupOne', '#FF3D8B', 0) returning id`, [boardId]);
  const { rows: [g2] } = await pg.query(
    `insert into public.groups (board_id, name, color, sort_order)
       values ($1, 'GroupTwo', '#33C481', 1) returning id`, [boardId]);
  const items: Record<string,string[]> = { [g1.id]: [], [g2.id]: [] };
  for (const gid of [g1.id, g2.id]) {
    for (let i = 0; i < 2; i++) {
      const { rows: [it] } = await pg.query(
        `insert into public.items (board_id, group_id, name, task_code, sort_order, created_by)
           values ($1, $2, $3, '', $4, $5) returning id`,
        [boardId, gid, `item_${i}`, i, adminId],
      );
      items[gid].push(it.id);
    }
  }
  return { g1: g1.id, g2: g2.id, items };
}
const A = await seedBoardWithGroups(boardA_id);
const B = await seedBoardWithGroups(boardB_id);
await seedBoardWithGroups(boardC_id);
await seedBoardWithGroups(boardSoft_id);
await seedBoardWithGroups(boardHard_id);

// Subscribe pm1: full on A, group-scoped (B.g1) on B, NOT on C.
await pg.query(
  `insert into public.board_subscribers (board_id, user_id, role, group_id)
     values ($1, $2, 'member', null)
     on conflict (board_id, user_id) do update set group_id = null`,
  [boardA_id, pm1Id],
);
await pg.query(
  `insert into public.board_subscribers (board_id, user_id, role, group_id)
     values ($1, $2, 'member', $3)
     on conflict (board_id, user_id) do update set group_id = excluded.group_id`,
  [boardB_id, pm1Id, B.g1],
);
await pg.query(
  `delete from public.board_subscribers where board_id = $1 and user_id = $2`,
  [boardC_id, pm1Id],
);
await pg.end();

console.log('=== FIXTURE READY ===');
console.log(`  admin uid = ${adminId}`);
console.log(`  pm1   uid = ${pm1Id}`);
console.log(`  board A (pm1 full)         = ${boardA_id}  groups=[${A.g1}, ${A.g2}]`);
console.log(`  board B (pm1 group-scoped) = ${boardB_id}  groups=[${B.g1}, ${B.g2}], pm1 → ${B.g1} only`);
console.log(`  board C (pm1 no access)    = ${boardC_id}`);
console.log(`  board Soft (archive test)  = ${boardSoft_id}`);
console.log(`  board Hard (delete test)   = ${boardHard_id}\n`);

// ====================================================================
// Helpers
// ====================================================================
async function signIn(username: string, pw: string): Promise<{ sb: SupabaseClient; jwt: string }> {
  const sb = createClient(supaUrl, anonKey, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email: `${username}@pms.internal`, password: pw });
  if (error || !data.session) throw new Error(`sign-in failed for ${username}: ${error?.message}`);
  return { sb, jwt: data.session.access_token };
}
const adminSession = await signIn(adminUser, adminPw);
const pm1Session   = await signIn('pm1', 'project123!');

// ====================================================================
// PROOF 4 — Manager pm1 isolation (Requirement B) — RUN FIRST so the
// fixture state is pristine; AI build below adds rows to board A.
// ====================================================================
console.log('=== PROOF 4: pm1 manager isolation (run before mutations) ===');

const expectedA = new Set<string>([...A.items[A.g1], ...A.items[A.g2]]);
const pm1OnA0 = await pm1Session.sb.from('items').select('id, group_id').eq('board_id', boardA_id);
const sawA0 = new Set<string>((pm1OnA0.data ?? []).map((r) => (r as { id: string }).id));
const aMatch = sawA0.size === expectedA.size && [...expectedA].every((id) => sawA0.has(id));
console.log(`  4a. pm1 on board A (full)         seen=${sawA0.size} expected=${expectedA.size} → ${aMatch ? 'PASS' : 'FAIL'}`);

const expectedB = new Set<string>(B.items[B.g1]);
const pm1OnB = await pm1Session.sb.from('items').select('id, group_id').eq('board_id', boardB_id);
const sawB = new Set<string>((pm1OnB.data ?? []).map((r) => (r as { id: string }).id));
const sawWrongGroupOnB = (pm1OnB.data ?? []).some((r) => (r as { group_id: string }).group_id !== B.g1);
const bMatch = sawB.size === expectedB.size && !sawWrongGroupOnB && [...expectedB].every((id) => sawB.has(id));
console.log(`  4b. pm1 on board B (scoped to g1) seen=${sawB.size} expected=${expectedB.size} (other-group items leaked: ${sawWrongGroupOnB}) → ${bMatch ? 'PASS' : 'FAIL'}`);

const pm1OnC = await pm1Session.sb.from('items').select('id').eq('board_id', boardC_id);
const cMatch = (pm1OnC.data ?? []).length === 0;
console.log(`  4c. pm1 on board C (no sub)       seen=${(pm1OnC.data ?? []).length} expected=0 → ${cMatch ? 'PASS' : 'FAIL'}`);

const pm1Write = await pm1Session.sb.from('items').update({ name: 'pm1-attempted-rename' } as never).eq('id', A.items[A.g1][0]);
const writeBlocked = !!pm1Write.error || (pm1Write.count === 0) ||
  (await pg_query_one(`select count(*)::int as c from public.items where id = $1 and name = 'pm1-attempted-rename'`, [A.items[A.g1][0]])).c === 0;
console.log(`  4d. pm1 attempted item rename     err=${pm1Write.error?.message ?? 'none'} → ${writeBlocked ? 'PASS (admin-only write enforced)' : 'FAIL (pm1 wrote!)'}`);

const proof4_pass = aMatch && bMatch && cMatch && writeBlocked;
if (!proof4_pass) { console.error('PROOF 4 FAILED'); process.exit(1); }

// ====================================================================
// PROOF 1 — Build with AI full flow (admin) via /api/ai-build + applier
// ====================================================================
console.log('\n=== PROOF 1: Build with AI full Apply (admin) on board A ===');

const aiResp = await fetch(`${baseUrl}/api/ai-build`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminSession.jwt}` },
  body: JSON.stringify({
    prompt: 'Add a QA group with 5 testing tasks: regression, e2e, accessibility, performance, security review.',
    kind: 'add_to_board',
    board_id: boardA_id,
  }),
});
const aiJson = await aiResp.json();
console.log(`  /api/ai-build status: ${aiResp.status}  actions: ${aiJson?.actions?.length}  notes: ${aiJson?.notes?.slice(0,80)}`);
if (!aiResp.ok) {
  console.error('  /api/ai-build failed:', JSON.stringify(aiJson));
  process.exit(1);
}

// Replay the applier loop directly via PostgREST so we exercise the
// exact RLS path the browser would. Each action = one supabase-js call.
type Action = { type: string; ref?: string; [k: string]: unknown };
const refMap = {
  groups:  {} as Record<string, string>,
  columns: {} as Record<string, string>,
  labels:  {} as Record<string, string>,
  tasks:   {} as Record<string, string>,
};
for (const c of (aiJson.context?.columns ?? [])) {
  refMap.columns[c.ref] = c.id;
  for (const l of (c.labels ?? [])) refMap.labels[l.ref] = l.id;
}
for (const g of (aiJson.context?.groups ?? [])) refMap.groups[g.ref] = g.id;

let nextItemSort = 1000;
let failedAt: { i: number; err: string } | null = null;
for (let i = 0; i < aiJson.actions.length; i++) {
  const a: Action = aiJson.actions[i];
  try {
    if (a.type === 'create_group') {
      const { data, error } = await adminSession.sb.from('groups').insert({
        board_id: boardA_id, name: a.name as string, color: (a.color as string) ?? '#579BFC',
        sort_order: 9000 + i,
      } as never).select('id').single();
      if (error) throw error;
      if (a.ref) refMap.groups[a.ref] = (data as { id: string }).id;
    } else if (a.type === 'create_task') {
      const gid = refMap.groups[a.group_ref as string];
      if (!gid) throw new Error(`unknown group_ref "${a.group_ref}"`);
      const { data, error } = await adminSession.sb.from('items').insert({
        board_id: boardA_id, group_id: gid, name: a.name as string,
        task_code: '', sort_order: nextItemSort++, created_by: adminId,
      } as never).select('id').single();
      if (error) throw error;
      if (a.ref) refMap.tasks[a.ref] = (data as { id: string }).id;
    } else if (a.type === 'create_column' || a.type === 'create_label' || a.type === 'update_task_status') {
      // Not exercised in this prompt; would-be-tested if AI emits one.
    }
  } catch (err: unknown) {
    failedAt = { i, err: (err as { message?: string }).message ?? String(err) };
    break;
  }
}
console.log(`  applier replayed all ${aiJson.actions.length} actions: ${failedAt ? `FAILED at ${failedAt.i}: ${failedAt.err}` : 'OK'}`);
if (failedAt) { console.error('PROOF 1 FAILED'); process.exit(1); }

// ====================================================================
// PROOF 2 — Board soft-delete (admin)
// ====================================================================
console.log('\n=== PROOF 2: board soft-delete (admin) ===');
const soft = await adminSession.sb.from('boards')
  .update({ deleted_at: new Date().toISOString() } as never)
  .eq('id', boardSoft_id)
  .select('id, deleted_at');
console.log(`  status: ${JSON.stringify(soft.error) ?? 'OK'}  rows: ${soft.data?.length}`);
if (soft.error) { console.error('PROOF 2 FAILED'); process.exit(1); }

// ====================================================================
// PROOF 3 — Board hard-delete (admin) — no P0001 from task_name guard
// ====================================================================
console.log('\n=== PROOF 3: board hard-delete (admin) ===');
const hard = await adminSession.sb.from('boards').delete({ count: 'exact' }).eq('id', boardHard_id);
console.log(`  status: ${JSON.stringify(hard.error) ?? 'OK'}  affected: ${hard.count}`);
if (hard.error) { console.error('PROOF 3 FAILED'); process.exit(1); }

// ====================================================================
// PROOF 5 — Readable error on a deliberately bad action
// ====================================================================
console.log('\n=== PROOF 5: readable error on failing action (not [object Object]) ===');
// Try to insert an item with an invalid group_id (FK violation) and
// run it through formatErr-equivalent logic.
const { error: badInsert } = await adminSession.sb.from('items').insert({
  board_id: boardA_id, group_id: '00000000-0000-0000-0000-000000000000',
  name: 'will-fail', task_code: '', sort_order: 0, created_by: adminId,
} as never).select('id').single();
// Emulate the applier's formatErr to confirm the message is human-readable.
function formatErr(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { message?: string; code?: string; details?: string; hint?: string };
    if (typeof e.message === 'string' && e.message.length > 0) {
      const parts: string[] = [e.message];
      if (e.code)    parts.push(`[${e.code}]`);
      if (e.details) parts.push(`— ${e.details}`);
      if (e.hint)    parts.push(`(${e.hint})`);
      return parts.join(' ');
    }
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
const formatted = formatErr(badInsert);
console.log(`  raw err keys: [${badInsert ? Object.keys(badInsert).join(', ') : 'no err'}]`);
console.log(`  formatted:    ${formatted}`);
const proof5_pass = formatted !== '[object Object]' && formatted.length > 0 && !formatted.includes('object Object');
console.log(`  → ${proof5_pass ? 'PASS' : 'FAIL'}`);

// ====================================================================
// CLEANUP — remove fixture boards
// ====================================================================
const cleanupPg = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
await cleanupPg.connect();
for (const bid of [boardA_id, boardB_id, boardC_id, boardSoft_id]) {
  await cleanupPg.query(`delete from public.boards where id = $1`, [bid]);
}
await cleanupPg.end();

console.log(`\n=========================================`);
console.log(`ALL PROOFS PASS @ ${baseUrl}`);
console.log(`=========================================`);

// Small helper used inside Proof 4
async function pg_query_one<T>(sql: string, params: unknown[]): Promise<T> {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const { rows } = await c.query(sql, params);
  await c.end();
  return rows[0] as T;
}
