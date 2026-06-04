/**
 * Diagnostic for: "admin lock must pause the timer; unlock must resume
 * without advancing the period; admin panel must show paused state."
 *
 * READ-ONLY against live prod DB.
 *
 * Prints:
 *   1. Live body of shift_admin_lock + shift_admin_unlock + shift_tick.
 *   2. Whether the pause fields exist in the schema.
 *   3. Whether shift_admin_unlock branches on locked_reason for the
 *      current_period_index advance.
 *
 * No mutations; no transaction; SELECTs only.
 */
import './loadEnv';
import { Client } from 'pg';

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const fnNames = ['shift_admin_lock', 'shift_admin_unlock', 'shift_tick'];
    for (const name of fnNames) {
      const { rows } = await c.query<{ pg_get_functiondef: string }>(
        `select pg_get_functiondef(p.oid)
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname='public' and p.proname=$1
          order by p.oid desc limit 1;`,
        [name],
      );
      console.log(`\n========== ${name} (live) ==========\n`);
      console.log(rows[0]?.pg_get_functiondef ?? '(missing)');
    }

    console.log(`\n========== pause-related columns on shift_sessions ==========`);
    const { rows: cols } = await c.query<{ column_name: string; data_type: string; column_default: string | null }>(
      `select column_name, data_type, column_default
         from information_schema.columns
        where table_schema='public' and table_name='shift_sessions'
          and column_name in (
            'paused_total_seconds',
            'current_pause_started_at',
            'current_pause_reason',
            'current_period_index',
            'locked_reason',
            'locked_by',
            'locked_at',
            'started_at'
          )
        order by column_name;`,
    );
    for (const r of cols) console.log(`  ${r.column_name.padEnd(28)}  ${r.data_type.padEnd(28)}  default=${r.column_default ?? 'NULL'}`);
  } finally {
    await c.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
