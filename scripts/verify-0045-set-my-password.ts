/** End-to-end verifier for set_my_password (mirrors the new frontend flow). */
import './loadEnv';
import { createClient } from '@supabase/supabase-js';

async function main() {
  console.log('---- 0045 set_my_password end-to-end ----');
  const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const s = await sb.auth.signInWithPassword({ email: 'admin@pms.internal', password: 'admin1234' });
  console.log('signin admin1234 -> ' + (s.data?.session ? 'OK' : 'FAIL'));

  const r = await sb.rpc('set_my_password', { p_new_password: 'TempProof!42' });
  console.log('set_my_password(TempProof!42) -> err=' + (r.error?.message ?? 'none'));

  const sb2 = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const s2 = await sb2.auth.signInWithPassword({ email: 'admin@pms.internal', password: 'TempProof!42' });
  console.log('signin TempProof!42 -> ' + (s2.data?.session ? 'OK' : 'FAIL'));

  if (s2.data?.session) {
    const reset = await sb2.rpc('set_my_password', { p_new_password: 'admin1234' });
    console.log('reset -> err=' + (reset.error?.message ?? 'none'));
    const sb3 = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const s3 = await sb3.auth.signInWithPassword({ email: 'admin@pms.internal', password: 'admin1234' });
    console.log('final signin admin1234 -> ' + (s3.data?.session ? 'OK' : 'FAIL'));
  }
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
