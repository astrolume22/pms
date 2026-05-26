/**
 * Reproduce the "Auth session missing!" change-password bug by mirroring
 * the EXACT call sequence in _app.profile.tsx onChangePassword:
 *   1) signInWithPassword (page load) → sets session
 *   2) verify_current_password(currentPw)
 *   3) supabase.auth.updateUser({ password: newPw })   <-- expect failure here
 *   4) verify_current_password(newPw)
 */
import './loadEnv';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'pms.auth' },
});

async function main() {
  console.log('---- repro Auth session missing ----');

  const r = await sb.auth.signInWithPassword({ email: 'admin@pms.internal', password: 'admin1234' });
  console.log('[1] signin   ok=' + !!r.data?.session + '  uid=' + r.data?.user?.id?.slice(0, 8));
  if (r.error) { console.error('   error: ' + r.error.message); process.exit(1); }

  const v = await sb.rpc('verify_current_password', { p_password: 'admin1234' });
  console.log('[2] verify1  data=' + v.data + '  err=' + (v.error?.message ?? 'none'));

  // Look at what supabase.auth.getSession() says right before updateUser
  const sess = await sb.auth.getSession();
  console.log('[2b] getSession before updateUser: hasSession=' + !!sess.data?.session);

  const u = await sb.auth.updateUser({ password: 'admin1234' });
  console.log('[3] updateUser err=' + (u.error?.message ?? 'none') + '  ok=' + !!u.data?.user);

  const v2 = await sb.rpc('verify_current_password', { p_password: 'admin1234' });
  console.log('[4] verify2  data=' + v2.data + '  err=' + (v2.error?.message ?? 'none'));
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
