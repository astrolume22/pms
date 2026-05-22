/**
 * Phase 2 smoke test: GET /api/ai-health
 *
 * Signs in as the master admin (via the same username@pms.internal
 * convention the app uses), then hits the deployed function and prints
 * the JSON body. Run after Vercel deploy is "Ready" to confirm the new
 * endpoint is wired correctly + GEMINI_API_KEY is set in prod env vars.
 *
 *   npx tsx scripts/smoke-ai-health.ts
 *   npx tsx scripts/smoke-ai-health.ts https://other-host
 */
import './loadEnv';
import { createClient } from '@supabase/supabase-js';

const HOST = process.argv[2] ?? 'https://pms-snowy-eight.vercel.app';

const supabaseUrl     = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
const adminUsername   = process.env.MASTER_ADMIN_USERNAME;
const adminPassword   = process.env.MASTER_ADMIN_PASSWORD;
if (!supabaseUrl || !supabaseAnonKey || !adminUsername || !adminPassword) {
  console.error('Missing env vars: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / MASTER_ADMIN_USERNAME / MASTER_ADMIN_PASSWORD');
  process.exit(1);
}

const email = `${adminUsername.trim().toLowerCase()}@pms.internal`;
const sb = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  console.log(`[1/3] signing in as ${email} …`);
  const { data: signIn, error: signInErr } = await sb.auth.signInWithPassword({ email, password: adminPassword! });
  if (signInErr || !signIn.session) throw signInErr ?? new Error('no session');
  const jwt = signIn.session.access_token;
  console.log('     ok — got JWT (' + jwt.length + ' chars)');

  console.log(`[2/3] GET ${HOST}/api/ai-health …`);
  const resp = await fetch(`${HOST}/api/ai-health`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${jwt}` },
  });
  const text = await resp.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }
  console.log(`     status: ${resp.status}`);
  console.log('     body:  ', JSON.stringify(body, null, 2));

  console.log('[3/3] negative cases');
  const noAuth = await fetch(`${HOST}/api/ai-health`, { method: 'GET' });
  console.log(`     no auth → ${noAuth.status}  ${(await noAuth.text()).slice(0, 80)}`);
  const wrongMethod = await fetch(`${HOST}/api/ai-health`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
  });
  console.log(`     POST    → ${wrongMethod.status}  ${(await wrongMethod.text()).slice(0, 80)}`);

  if (resp.status !== 200) process.exit(1);
  const parsed = body as { ok?: boolean; has_key?: boolean; model?: string };
  if (parsed.ok !== true)   { console.error('FAIL: ok !== true');      process.exit(1); }
  if (parsed.has_key !== true) { console.error('FAIL: has_key !== true'); process.exit(1); }
  if (parsed.model !== 'gemini-2.5-flash') { console.error('FAIL: wrong model'); process.exit(1); }
  console.log('\n✅ /api/ai-health smoke test passed.');
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
