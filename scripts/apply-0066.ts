/**
 * Apply 0066 (items_select soft-delete trap fix re-apply) + prove the
 * soft-delete UPDATE now succeeds for the admin via PostgREST.
 *
 *   1. Apply migration (CREATE POLICY idempotent via DROP POLICY IF EXISTS).
 *   2. Re-read pg_policies; assert items_select USING NO LONGER contains
 *      `deleted_at IS NULL`.
 *   3. End-to-end PostgREST PATCH as the admin with Prefer:return=minimal
 *      and {"deleted_at":"now"} — assert 204 No Content (no 42501).
 *      Immediately UNDO via PATCH {"deleted_at": null} so nothing persists.
 */
import './loadEnv';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const FILE = 'supabase/migrations/20260609_0066_items_select_soft_delete_fix_reapply.sql';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY!;

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();

  // ---- BEFORE ----
  const { rows: [before] } = await c.query<{ qual: string | null }>(
    `select qual from pg_policies where schemaname='public' and tablename='items' and policyname='items_select'`,
  );
  console.log('BEFORE — items_select USING:');
  console.log('  ' + (before?.qual ?? '(none)'));
  const beforeTrap = /deleted_at\s+is\s+null/i.test(before?.qual ?? '');
  console.log('  contains `deleted_at IS NULL`? ' + beforeTrap);

  // ---- APPLY ----
  console.log('\n========== APPLY ' + FILE + ' ==========');
  await c.query(readFileSync(FILE, 'utf8'));
  console.log('applied.');

  // ---- AFTER ----
  const { rows: [after] } = await c.query<{ qual: string | null }>(
    `select qual from pg_policies where schemaname='public' and tablename='items' and policyname='items_select'`,
  );
  console.log('\nAFTER — items_select USING:');
  console.log('  ' + (after?.qual ?? '(none)'));
  const afterTrap = /deleted_at\s+is\s+null/i.test(after?.qual ?? '');
  console.log('  contains `deleted_at IS NULL`? ' + afterTrap);
  if (afterTrap) { console.error('FAIL — trap still present'); process.exit(1); }

  // Pick an admin + a real item to test against.
  const { rows: [admin] } = await c.query<{ id: string; email: string }>(
    `select id, email from public.users where role='admin' and status='active' limit 1`,
  );
  const { rows: [victim] } = await c.query<{ id: string; name: string; deleted_at: string | null }>(
    `select id, name, deleted_at from public.items where deleted_at is null limit 1`,
  );
  console.log('\nadmin :', admin);
  console.log('victim:', victim);

  await c.end();

  // ---- E2E PROBE: PATCH /rest/v1/items?id=eq.<X> Prefer:return=minimal {deleted_at:now} ----
  async function signIn(email: string, password: string): Promise<string | null> {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const body = await r.text();
    if (!r.ok) { console.error('signIn fail:', r.status, body); return null; }
    return (JSON.parse(body) as { access_token: string }).access_token;
  }
  async function patchItem(token: string, itemId: string, patch: object) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/items?id=eq.${itemId}`, {
      method: 'PATCH',
      headers: {
        'apikey': ANON_KEY,
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(patch),
    });
    return { status: r.status, body: await r.text() };
  }

  const DEV_PW = process.env.PMS_DEV_PASSWORD ?? 'admin1234';
  const adminTok = await signIn(admin.email, DEV_PW);
  if (!adminTok) { console.error('FAIL — admin sign-in failed; cannot e2e probe'); process.exit(1); }

  console.log('\n========== E2E PROBE — soft-delete as admin via PostgREST ==========');
  const r = await patchItem(adminTok, victim.id, { deleted_at: new Date().toISOString() });
  console.log('  PATCH {deleted_at:now}   status=' + r.status + (r.body ? '  body=' + r.body : ''));
  if (r.status !== 204) {
    console.error('FAIL — expected 204 No Content; soft-delete still rejected');
    process.exit(1);
  }
  console.log('  ✅ soft-delete succeeded (204 No Content) — no 42501');

  // UNDO so nothing remains soft-deleted.
  const u = await patchItem(adminTok, victim.id, { deleted_at: null });
  console.log('  UNDO  {deleted_at:null}  status=' + u.status + (u.body ? '  body=' + u.body : ''));
  if (u.status !== 204) {
    console.error('FAIL — undo did not return 204; row may remain soft-deleted!');
    process.exit(1);
  }
  console.log('  ✅ undo succeeded — row restored, no data persisted');

  console.log('\n✅ 0066 verified: items soft-delete works, RLS trap removed.');
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
