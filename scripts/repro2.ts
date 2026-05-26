import './loadEnv';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'pms.auth' },
});

async function main() {
  const r = await sb.auth.signInWithPassword({ email: 'admin@pms.internal', password: 'admin1234' });
  console.log('signin ok=' + !!r.data?.session);
  const v = await sb.rpc('verify_current_password', { p_password: 'admin1234' });
  console.log('verify1 data=' + v.data);
  const u = await sb.auth.updateUser({ password: 'admin5678!aa' });
  console.log('updateUser err=' + (u.error?.message ?? 'none') + '  ok=' + !!u.data?.user);
  if (!u.error) {
    const back = await sb.auth.updateUser({ password: 'admin1234' });
    console.log('reset err=' + (back.error?.message ?? 'none'));
  }
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
