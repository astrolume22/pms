/**
 * Apply 0043 — flip user-authorship FKs to SET NULL + admin_delete_user.
 * Re-runs the FK diagnostic afterwards to prove the flips landed.
 */
import './loadEnv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const url = process.env.DATABASE_URL!;

async function main() {
  const sql = readFileSync(
    join(process.cwd(), 'supabase/migrations/20260526_0043_admin_delete_user.sql'),
    'utf8',
  );
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('begin');
    await c.query(sql);
    await c.query('commit');
    console.log('OK: 0043 applied.');

    // Post-apply: dump the 9 flipped FKs to prove SET NULL.
    const flipped = [
      'boards_created_by_fk', 'boards_owner_fk', 'items_created_by_fk',
      'updates_author_fk',    'views_created_by_fk', 'files_uploader_fk',
      'invites_created_by_fk','activity_log_actor_fk','ai_runs_user_fk',
    ];
    const { rows } = await c.query<{ conname: string; del: string }>(
      `select conname, confdeltype::text as del
         from pg_constraint
        where contype='f' and conname = any($1);`,
      [flipped],
    );
    const map = { a:'NO ACTION', r:'RESTRICT', c:'CASCADE', n:'SET NULL', d:'SET DEFAULT' } as Record<string,string>;
    console.log('  flipped FKs:');
    for (const r of rows) console.log('   - ' + r.conname + ' -> ' + (map[r.del] ?? r.del));

    // admin_delete_user signature + grants
    const { rows: [fn] } = await c.query<{ exists: boolean; sd: boolean }>(
      `select exists (select 1 from pg_proc where proname='admin_delete_user' and pronamespace='public'::regnamespace) as exists,
              (select prosecdef from pg_proc where proname='admin_delete_user' and pronamespace='public'::regnamespace limit 1) as sd;`,
    );
    console.log('  admin_delete_user exists?    ' + (fn.exists ? 'YES' : 'NO'));
    console.log('  admin_delete_user sec defin? ' + (fn.sd ? 'YES' : 'NO'));

    const { rows: acls } = await c.query<{ grantee: string; privilege_type: string }>(
      `select grantee, privilege_type from information_schema.routine_privileges
        where routine_schema='public' and routine_name='admin_delete_user';`,
    );
    console.log('  grants:');
    for (const a of acls) console.log('   - ' + a.grantee + ' / ' + a.privilege_type);
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    await c.end();
  }
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
