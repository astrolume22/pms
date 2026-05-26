/**
 * Accept a fresh invite (no UI) so we have a throwaway test user
 * in the live admin Users panel to delete via the live UI proof.
 */
import './loadEnv';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const ANON_KEY     = process.env.VITE_SUPABASE_ANON_KEY!;
const TOKEN        = process.argv[2];
if (!TOKEN) { console.error('usage: accept-for-ui-proof <token>'); process.exit(1); }

async function main() {
  const sb = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.rpc('accept_invite', {
    p_token: TOKEN,
    p_full_name: 'Delete Me UI Proof',
    p_password: 'DeleteMe!12345',
  });
  if (error) { console.error('accept_invite error:', error.message); process.exit(1); }
  console.log(JSON.stringify(data, null, 2));
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
