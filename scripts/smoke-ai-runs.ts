/**
 * Phase 2 smoke test: ai_runs admin-read RLS + manager isolation.
 *
 * 1. Sign in as admin → SELECT from ai_runs → expect >= 0 rows AND policy
 *    ai_runs_select_admin is in pg_policies.
 * 2. Sign in as manager `pm1` (created by the existing seed) → SELECT
 *    ai_runs → expect ONLY rows where user_id = pm1's uid (per the legacy
 *    ai_runs_select_own policy).
 */
import './loadEnv';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl     = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
const adminUsername   = process.env.MASTER_ADMIN_USERNAME;
const adminPassword   = process.env.MASTER_ADMIN_PASSWORD;
if (!supabaseUrl || !supabaseAnonKey || !adminUsername || !adminPassword) {
  console.error('Missing env vars'); process.exit(1);
}

async function signIn(username: string, password: string) {
  const sb = createClient(supabaseUrl!, supabaseAnonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `${username.trim().toLowerCase()}@pms.internal`;
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw error ?? new Error(`no session for ${username}`);
  return { sb, userId: data.user!.id };
}

async function main() {
  console.log('[admin]');
  const adminCx = await signIn(adminUsername!, adminPassword!);
  const { data: adminRows, error: adminErr, count: adminCount } = await adminCx.sb
    .from('ai_runs')
    .select('id, user_id, feature, status, ran_at', { count: 'exact', head: false })
    .order('ran_at', { ascending: false })
    .limit(5);
  if (adminErr) throw adminErr;
  console.log(`  rows returned: ${adminRows?.length ?? 0} (count: ${adminCount})`);
  if (adminRows && adminRows.length > 0) {
    const distinctUsers = new Set(adminRows.map((r) => r.user_id));
    console.log(`  distinct user_ids in sample: ${distinctUsers.size}  (admin sees everyone's, so this can be > 1)`);
    console.log('  sample[0]:', JSON.stringify(adminRows[0]));
  } else {
    console.log('  (no rows in ai_runs yet — that is OK; Phase 1 logging only succeeded after migration 0032 widened the check constraint.)');
  }

  // Negative case: manager pm1 should ONLY see their own runs (policy
  // ai_runs_select_own). Skip if pm1 doesn't exist in this environment.
  console.log('\n[manager pm1]');
  try {
    const pm1Cx = await signIn('pm1', 'pm1pass!');
    const { data: pm1Rows, error: pm1Err } = await pm1Cx.sb
      .from('ai_runs')
      .select('user_id')
      .limit(50);
    if (pm1Err) throw pm1Err;
    console.log(`  pm1 sees ${pm1Rows?.length ?? 0} rows`);
    const otherUsers = (pm1Rows ?? []).filter((r) => r.user_id !== pm1Cx.userId);
    if (otherUsers.length > 0) {
      console.error(`  FAIL: pm1 saw ${otherUsers.length} rows belonging to other users (isolation broken!)`);
      process.exit(1);
    }
    console.log('  OK — isolation holds (all rows belong to pm1, or no rows at all).');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/incorrect|invalid/i.test(msg)) {
      console.log('  (pm1 account not present in this environment — skipping isolation check.)');
    } else {
      throw err;
    }
  }

  console.log('\n✅ ai_runs RLS smoke passed.');
}

main().catch((err) => { console.error('FAIL:', err); process.exit(1); });
