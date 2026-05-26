/**
 * Reproduce the duplicate_group failure live.
 *
 * Signs in as admin, picks a real group from one of the existing boards,
 * calls supabase.rpc('duplicate_group', ...) and prints the full error
 * (status / code / message / details / hint).
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
  console.log('admin signed in');

  // Pick a real group with at least one item.
  const db = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await db.connect();
  const { rows } = await db.query<{ id: string; name: string; board_id: string; item_count: string }>(
    `select g.id, g.name, g.board_id, count(i.id) as item_count
       from public.groups g
       left join public.items i on i.group_id = g.id and i.deleted_at is null
      where g.deleted_at is null
      group by g.id, g.name, g.board_id
      having count(i.id) > 0
      order by item_count desc
      limit 5;`,
  );
  console.log('Candidate groups (with items):');
  for (const r of rows) console.log('  ' + r.id.slice(0,8) + '  "' + r.name + '"  items=' + r.item_count);
  if (rows.length === 0) { console.error('No candidate groups.'); await db.end(); process.exit(1); }

  // Try the first one.
  const target = rows[0];
  console.log('\nAttempting duplicate_group on: ' + target.id + '  "' + target.name + '"');
  const r = await sb.rpc('duplicate_group', { p_group_id: target.id });
  console.log('  data:    ' + JSON.stringify(r.data));
  console.log('  error:   ' + JSON.stringify(r.error));

  // Also try via raw pg client as admin's auth.uid() so we see the postgres-level error.
  const { rows: [adminRow] } = await db.query<{ id: string }>(`select id from public.users where username='admin'`);
  console.log('\nReplay via direct DB call (as admin uid=' + adminRow.id.slice(0,8) + ')...');
  try {
    // Mimic SECURITY DEFINER caller by setting auth.uid() via local config var.
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [adminRow.id]);
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: adminRow.id, role: 'authenticated' })]);
    const dr = await db.query<{ duplicate_group: string }>(`select public.duplicate_group($1::uuid)`, [target.id]);
    console.log('  direct call returned new group id: ' + dr.rows[0].duplicate_group);
  } catch (e: unknown) {
    const ex = e as { code?: string; message?: string; detail?: string; hint?: string; constraint?: string };
    console.log('  direct call THROWS:');
    console.log('    code:      ' + ex.code);
    console.log('    message:   ' + ex.message);
    console.log('    detail:    ' + ex.detail);
    console.log('    hint:      ' + ex.hint);
    console.log('    constraint:' + ex.constraint);
  }

  await db.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
