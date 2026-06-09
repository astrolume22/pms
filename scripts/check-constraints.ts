import './loadEnv';
import { Client } from 'pg';
async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();
  // CHECK constraints on shift_sessions and shift_events
  for (const t of ['shift_sessions','shift_events']) {
    const { rows } = await c.query(`
      select conname, pg_get_constraintdef(c.oid) as def
        from pg_constraint c
        join pg_class cl on cl.oid = c.conrelid
        join pg_namespace n on n.oid = cl.relnamespace
       where n.nspname='public' and cl.relname=$1 and c.contype='c'`,[t]);
    console.log('=== '+t+' CHECK constraints ===');
    for (const r of rows) console.log(' ', r.conname, '→', r.def);
  }
  await c.end();
}
main().catch(e=>{console.error(e); process.exit(1);});
