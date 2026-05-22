/**
 * One-off diagnostic: dump the ai_runs table's check constraints + RLS
 * policies as they exist in the live DB, so we can confirm migration
 * 0032 widened the feature check.
 */
import './loadEnv';
import { Client } from 'pg';

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  console.log('-- check constraints on public.ai_runs --');
  const { rows: cks } = await c.query(`
    select c.conname, pg_get_constraintdef(c.oid) as def
      from pg_constraint c
     where c.conrelid = 'public.ai_runs'::regclass
       and c.contype  = 'c'
     order by c.conname;
  `);
  for (const r of cks) console.log(' ', r.conname, ':', r.def);

  console.log('\n-- RLS policies on public.ai_runs --');
  const { rows: pols } = await c.query(`
    select policyname, cmd, roles, qual, with_check
      from pg_policies
     where schemaname = 'public' and tablename = 'ai_runs'
     order by policyname;
  `);
  for (const p of pols) {
    console.log(' ', p.policyname, '(', p.cmd, ')');
    console.log('     using:  ', p.qual);
    console.log('     check:  ', p.with_check);
  }

  console.log('\n-- direct test: can we INSERT a row as the postgres role? --');
  await c.query(`begin`);
  const { rows: testInsert } = await c.query(`
    insert into public.ai_runs (user_id, feature, prompt, model, status)
    select (select id from public.users where role = 'admin' limit 1),
           'create_board', 'phase2-diag-test', 'gemini-2.5-flash', 'success'
    returning id, user_id, feature, status;
  `);
  console.log('  inserted:', testInsert[0]);
  await c.query(`rollback`);
  console.log('  rolled back.');

  console.log('\n-- recent rows (with statement_timeout off) --');
  const { rows: recent } = await c.query(`
    select id, user_id, feature, status, model, ran_at, left(coalesce(prompt,''),50) as prompt_snip
      from public.ai_runs
     order by ran_at desc
     limit 10;
  `);
  console.log(`  ${recent.length} rows:`, recent);

  await c.end();
}
main().catch((err) => { console.error(err); process.exit(1); });
