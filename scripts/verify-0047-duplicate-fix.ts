import './loadEnv';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';

async function main() {
  const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await sb.auth.signInWithPassword({ email: 'admin@pms.internal', password: 'admin1234' });

  // The two previously-failing groups from the repro.
  const ids = [
    '3442b081-a73c-4d22-9bf8-6f4ebd05316e',  // "Task for Axel Rose"
    '3f222c05-9d2a-4d2c-9aa9-fcbd1f96ee5d',  // "Team Red Projects"
  ];
  console.log('Re-attempting duplicate_group on the two previously failing groups:\n');
  for (const id of ids) {
    const r = await sb.rpc('duplicate_group', { p_group_id: id });
    console.log('  ' + id.slice(0, 8) + ' -> data=' + JSON.stringify(r.data) + '  err=' + (r.error?.message || 'none'));
    if (!r.error) {
      // Inspect the new group's items + values.
      const db = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
      await db.connect();
      const newId = r.data as string;
      const g = await db.query<{ name: string; sort_order: number }>(`select name, sort_order from public.groups where id=$1`, [newId]);
      const it = await db.query<{ n: string; codes: string }>(`select count(*) as n, string_agg(task_code, ', ' order by sort_order) as codes from public.items where group_id=$1`, [newId]);
      const v = await db.query<{ n: string }>(`select count(*) as n from public.item_column_values icv join public.items it on it.id=icv.item_id where it.group_id=$1`, [newId]);
      console.log('     new group: ' + JSON.stringify(g.rows[0]));
      console.log('     items: ' + it.rows[0].n + '  task_codes: ' + it.rows[0].codes);
      console.log('     copied column values: ' + v.rows[0].n);
      await db.end();
    }
  }
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
