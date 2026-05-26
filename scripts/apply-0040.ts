/**
 * One-shot applier for 0040 — invite email support.
 */
import './loadEnv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('Missing DATABASE_URL'); process.exit(1); }

async function main() {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20260524_0040_invite_email_support.sql'), 'utf8');
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('begin');
    await c.query(sql);
    await c.query('commit');
    console.log('✅ 0040 applied.');

    // Sanity checks.
    const { rows: [col] } = await c.query<{ data_type: string; is_nullable: string }>(
      `select data_type, is_nullable from information_schema.columns
        where table_schema='public' and table_name='invites' and column_name='invitee_email';`
    );
    console.log(`  invitee_email column: ${col?.data_type} (nullable=${col?.is_nullable})`);

    const { rows: [fn] } = await c.query<{ def: string }>(
      `select pg_get_functiondef(oid) as def from pg_proc
        where proname = 'create_invite' and pronamespace = 'public'::regnamespace;`
    );
    const hasInviteeArg = /p_invitee_email\s+text/i.test(fn.def);
    const hasEmailInsert = /invitee_email\)\s*values\s*\(/i.test(fn.def) || /invitee_email\)\s*\n?\s*values/i.test(fn.def);
    console.log(`  create_invite has p_invitee_email arg? ${hasInviteeArg ? 'YES' : 'NO'}`);
    console.log(`  create_invite INSERTs invitee_email?   ${hasEmailInsert ? 'YES' : 'NO'}`);

    const { rows: [acc] } = await c.query<{ def: string }>(
      `select pg_get_functiondef(oid) as def from pg_proc
        where proname = 'accept_invite' and pronamespace = 'public'::regnamespace;`
    );
    const hasDupGuard = /An active account already uses this email/i.test(acc.def);
    const hasFreed   = /freed_\s*\|\|/i.test(acc.def);
    const hasInviteeBranch = /v_invite\.invitee_email is not null/i.test(acc.def);
    console.log(`  accept_invite uses invite email branch? ${hasInviteeBranch ? 'YES' : 'NO'}`);
    console.log(`  accept_invite duplicate-active guard?   ${hasDupGuard ? 'YES' : 'NO'}`);
    console.log(`  accept_invite frees stale auth.users?   ${hasFreed ? 'YES' : 'NO'}`);
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    await c.end();
  }
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
