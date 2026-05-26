/**
 * Try to duplicate every group on every board (as admin via PostgREST RPC).
 * Logs whether each call succeeds or fails — to surface the real failing
 * group(s) the user is seeing.
 */
import './loadEnv';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';

async function main() {
  const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const s = await sb.auth.signInWithPassword({ email: 'admin@pms.internal', password: 'admin1234' });
  if (s.error) throw new Error('admin signin failed: ' + s.error.message);

  const db = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await db.connect();
  const { rows: groups } = await db.query<{ id: string; name: string; board_id: string; item_count: string }>(
    `select g.id, g.name, g.board_id, count(i.id) as item_count
       from public.groups g
       left join public.items i on i.group_id = g.id and i.deleted_at is null
      where g.deleted_at is null
        and g.name not ilike 'copy of%'
      group by g.id, g.name, g.board_id
      order by g.created_at desc;`,
  );
  console.log('Testing ' + groups.length + ' groups (non-Copy)...\n');

  let ok = 0, fail = 0;
  for (const g of groups) {
    const r = await sb.rpc('duplicate_group', { p_group_id: g.id });
    if (r.error) {
      fail++;
      console.log('FAIL ' + g.id.slice(0,8) + '  items=' + g.item_count + '  "' + g.name + '"');
      console.log('    code:    ' + (r.error as { code?: string }).code);
      console.log('    message: ' + r.error.message);
      console.log('    details: ' + (r.error as { details?: string }).details);
      console.log('    hint:    ' + (r.error as { hint?: string }).hint);
    } else {
      ok++;
      console.log('ok   ' + g.id.slice(0,8) + '  items=' + g.item_count + '  → new=' + String(r.data).slice(0,8));
    }
  }
  console.log('\nSummary: ' + ok + ' OK, ' + fail + ' FAIL');
  await db.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
