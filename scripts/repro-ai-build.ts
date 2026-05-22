/**
 * Hits the live /api/ai-build with a real admin JWT + a real board id
 * and shows the response + timing. Diagnostic only — delete after fix.
 */
import './loadEnv';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';

const url = process.env.VITE_SUPABASE_URL!;
const anonKey = process.env.VITE_SUPABASE_ANON_KEY!;
const adminUser = process.env.MASTER_ADMIN_USERNAME!;
const adminPw = process.env.MASTER_ADMIN_PASSWORD!;
const liveBase = process.argv[2] ?? 'https://pms-snowy-eight.vercel.app';

const sb = createClient(url, anonKey, { auth: { persistSession: false } });
const { data: sess, error: sErr } = await sb.auth.signInWithPassword({
  email: `${adminUser}@pms.internal`,
  password: adminPw,
});
if (sErr || !sess?.session) {
  console.error('admin sign-in failed:', sErr);
  process.exit(1);
}
const jwt = sess.session.access_token;
console.log('admin JWT len:', jwt.length, 'prefix:', jwt.slice(0, 20) + '…');

// Pick the first active board.
const pg = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
await pg.connect();
const { rows: [board] } = await pg.query(
  `select id, name from public.boards where deleted_at is null and archived_at is null order by created_at asc limit 1`,
);
await pg.end();
if (!board) { console.error('no board found'); process.exit(1); }
console.log('using board:', board.id, board.name);

const body = {
  prompt: 'Add a QA group with 5 testing tasks (regression, e2e, accessibility, performance, security review).',
  kind: 'add_to_board',
  board_id: board.id,
};

console.log(`\nPOST ${liveBase}/api/ai-build`);
const started = Date.now();
const resp = await fetch(`${liveBase}/api/ai-build`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
  body: JSON.stringify(body),
});
const elapsed = ((Date.now() - started) / 1000).toFixed(2);
const text = await resp.text();
console.log(`\nstatus: ${resp.status}  elapsed: ${elapsed}s`);
console.log('response:', text.length > 1200 ? text.slice(0, 1200) + ' …' + text.length + ' chars' : text);
