/**
 * Apply every SQL file in supabase/migrations in lexical order against the
 * Postgres connection string in DATABASE_URL (load .env.local first).
 *
 * Why a DB URL instead of the service role key?  Supabase doesn't expose
 * arbitrary SQL over PostgREST, so DDL has to go through a Postgres
 * connection.  Grab the URL from Supabase Dashboard → Project Settings →
 * Database → Connection string → URI (use the Pooler URL for IPv4).
 */
import './loadEnv';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(
    '\nMissing DATABASE_URL.\n' +
      'Add it to .env.local (Supabase → Settings → Database → Connection string → URI).\n' +
      'Use the Transaction or Session pooler URL if your network blocks direct port 5432.\n',
  );
  process.exit(1);
}

const migrationsDir = new URL('../supabase/migrations', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

async function run() {
  const client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    if (files.length === 0) {
      console.log('No migration files found.');
      return;
    }
    for (const file of files) {
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      process.stdout.write(`▸ ${file} ... `);
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('commit');
        console.log('ok');
      } catch (err) {
        await client.query('rollback');
        console.log('FAILED');
        throw err;
      }
    }
    console.log('\n✅ Migrations applied.');
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error('\n❌ Migration failed:', err.message ?? err);
  process.exit(1);
});
