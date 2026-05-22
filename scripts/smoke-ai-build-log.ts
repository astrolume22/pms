/**
 * Phase 2 end-to-end proof: trigger ONE /api/ai-build call, then confirm
 * a row landed in ai_runs. This verifies migration 0032's check-constraint
 * widening (the bug that made the best-effort log insert silently fail
 * for kind = 'add_to_board' and 'add_tasks').
 *
 * Uses kind='create_board' to keep it cheap (no board_id lookup needed).
 *
 *   npx tsx scripts/smoke-ai-build-log.ts
 */
import './loadEnv';
import { createClient } from '@supabase/supabase-js';

const HOST = process.argv[2] ?? 'https://pms-snowy-eight.vercel.app';

const supabaseUrl     = process.env.VITE_SUPABASE_URL!;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY!;
const username        = process.env.MASTER_ADMIN_USERNAME!;
const password        = process.env.MASTER_ADMIN_PASSWORD!;

async function main() {
  const sb = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `${username.trim().toLowerCase()}@pms.internal`;
  const { data: signIn, error: signInErr } = await sb.auth.signInWithPassword({ email, password });
  if (signInErr || !signIn.session) throw signInErr ?? new Error('no session');
  const jwt = signIn.session.access_token;
  const myUid = signIn.user!.id;

  // 1. snapshot row count BEFORE
  const { count: before } = await sb.from('ai_runs').select('id', { count: 'exact', head: true });

  // 2. fire ONE small /api/ai-build call
  console.log(`Calling ${HOST}/api/ai-build (kind=create_board) …`);
  const t0 = Date.now();
  const resp = await fetch(`${HOST}/api/ai-build`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({
      prompt: 'Phase-2 smoke: trivial 3-task project',
      kind:   'create_board',
    }),
  });
  const tookMs = Date.now() - t0;
  const text = await resp.text();
  console.log(`  status: ${resp.status} (${tookMs}ms)`);
  let body: { actions?: unknown[]; error?: string };
  try { body = JSON.parse(text); } catch { body = { error: text.slice(0, 200) }; }
  if (!resp.ok) {
    console.error('  FAIL response:', body);
    process.exit(1);
  }
  console.log(`  actions returned: ${(body.actions ?? []).length}`);

  // 3. give the best-effort insert a beat to land
  await new Promise((r) => setTimeout(r, 1500));

  const { count: after } = await sb.from('ai_runs').select('id', { count: 'exact', head: true });
  console.log(`\nai_runs count: before=${before}  after=${after}  Δ=${(after ?? 0) - (before ?? 0)}`);

  // 4. confirm the new row's shape
  const { data: latest } = await sb
    .from('ai_runs')
    .select('id, user_id, feature, status, model, ran_at, prompt')
    .eq('user_id', myUid)
    .order('ran_at', { ascending: false })
    .limit(1);
  if (!latest || latest.length === 0) {
    console.error('FAIL: no ai_runs row found for the admin caller after /api/ai-build');
    process.exit(1);
  }
  console.log('newest row:', JSON.stringify(latest[0], null, 2));

  if ((after ?? 0) - (before ?? 0) < 1) {
    console.error('FAIL: row count did not increase — logging path still broken?');
    process.exit(1);
  }
  if (latest[0].feature !== 'create_board') {
    console.error('FAIL: feature !== create_board on the new row'); process.exit(1);
  }
  if (latest[0].status !== 'success') {
    console.error('FAIL: status !== success on the new row'); process.exit(1);
  }
  console.log('\n✅ Phase 2 end-to-end proof passed.');
}

main().catch((err) => { console.error('FAIL:', err); process.exit(1); });
