/**
 * Mints a single fresh invite + prints the full accept URL so I can
 * paste it into the browser for UI proof of the new invite-accept page.
 */
import './loadEnv';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const ANON_KEY     = process.env.VITE_SUPABASE_ANON_KEY!;
const APP_ORIGIN   = 'https://p-m-system.vercel.app';

async function main() {
  const sb = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email: 'admin@pms.internal', password: 'admin1234' });
  if (error) throw new Error('admin login failed: ' + error.message);

  const email = 'uiproof-' + Date.now() + '@example.test';
  const { data: minted, error: e2 } = await sb.rpc('create_invite', {
    p_role: 'manager',
    p_board_id: null,
    p_expires_in_hours: 24,
    p_group_id: null,
    p_invitee_email: email,
  });
  if (e2) throw new Error('create_invite error: ' + e2.message);
  const m = minted as { token: string };
  console.log('Invitee email: ' + email);
  console.log('Accept URL:    ' + APP_ORIGIN + '/invite/' + m.token);
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
