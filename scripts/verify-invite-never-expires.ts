/**
 * End-to-end verifier for migration 0037 — never-expiring invite links.
 *
 * We can't exercise create_invite() directly from psql (the RPC checks
 * is_admin() via auth.uid(), which only resolves under a real JWT
 * session). So we test the two things that matter:
 *
 *   1. SCHEMA: invites.expires_at is nullable.
 *
 *   2. VALIDATION LOGIC: insert three test rows directly —
 *      a. expires_at = NULL                       (never expires)
 *      b. expires_at = now() + 1h                 (active, time-limited)
 *      c. expires_at = now() - 1h                 (already expired)
 *      Then call get_invite_by_token for each. The responses prove the
 *      `is not null AND <= now()` guard treats NULL as never-expires
 *      while still rejecting truly-expired rows.
 *
 *   3. FUNCTION BODIES: dump the create_invite/get_invite_by_token/
 *      accept_invite definitions and assert the null-aware guards are
 *      present.
 *
 * Cleans up after itself by deleting the test rows.
 */
import './loadEnv';
import { Client, type QueryResult } from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('Missing DATABASE_URL'); process.exit(1); }

async function main() {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  let createdTokens: string[] = [];
  try {
    // -----------------------------------------------------------------
    // 1. Schema: expires_at nullable
    // -----------------------------------------------------------------
    const sc: QueryResult<{ is_nullable: string }> = await c.query(`
      select is_nullable from information_schema.columns
      where table_schema='public' and table_name='invites' and column_name='expires_at';
    `);
    console.log(`[1] invites.expires_at nullable? ${sc.rows[0]?.is_nullable}`);
    if (sc.rows[0]?.is_nullable !== 'YES') {
      console.error('FAIL: column is not nullable');
      process.exit(1);
    }

    // -----------------------------------------------------------------
    // 2. Insert three test rows attributed to an admin user (FK)
    // -----------------------------------------------------------------
    const { rows: admins } = await c.query<{ id: string }>(
      `select id from public.users where role = 'admin' and status = 'active' limit 1;`
    );
    if (!admins[0]) {
      console.error('No active admin found — cannot attribute test rows.');
      process.exit(1);
    }
    const adminId = admins[0].id;

    const tNever   = 'verify_never_' + Math.random().toString(16).slice(2, 10);
    const tActive  = 'verify_active_' + Math.random().toString(16).slice(2, 10);
    const tExpired = 'verify_expired_' + Math.random().toString(16).slice(2, 10);

    await c.query(
      `insert into public.invites (token, role, board_id, created_by, expires_at)
       values
         ($1, 'manager', null, $4, null),
         ($2, 'manager', null, $4, now() + interval '1 hour'),
         ($3, 'manager', null, $4, now() - interval '1 hour');`,
      [tNever, tActive, tExpired, adminId]
    );
    createdTokens = [tNever, tActive, tExpired];

    // -----------------------------------------------------------------
    // 3. Validate each via get_invite_by_token
    // -----------------------------------------------------------------
    const check = async (token: string, name: string) => {
      const { rows } = await c.query<{ result: { valid: boolean; reason?: string; expires_at: string | null } }>(
        `select public.get_invite_by_token($1) as result;`, [token]
      );
      const r = rows[0].result;
      console.log(`[${name}] valid=${r.valid} reason=${r.reason ?? '(none)'} expires_at=${r.expires_at ?? 'NULL'}`);
      return r;
    };

    const rNever   = await check(tNever,   'never  ');
    const rActive  = await check(tActive,  'active ');
    const rExpired = await check(tExpired, 'expired');

    let fails = 0;
    if (rNever.valid !== true)                          { console.error('  ✗ never-expires invite should be valid'); fails++; }
    if (rNever.expires_at !== null)                     { console.error('  ✗ never-expires invite should report expires_at:null'); fails++; }
    if (rActive.valid !== true)                         { console.error('  ✗ active 1h invite should be valid'); fails++; }
    if (rExpired.valid !== false)                       { console.error('  ✗ past invite should be invalid'); fails++; }
    if (rExpired.reason !== 'expired')                  { console.error('  ✗ past invite should report reason:expired'); fails++; }

    // -----------------------------------------------------------------
    // 4. Function-body assertions
    // -----------------------------------------------------------------
    const dump = async (name: string) => {
      const { rows } = await c.query<{ def: string }>(
        `select pg_get_functiondef(oid) as def from pg_proc
         where proname = $1 and pronamespace = 'public'::regnamespace;`, [name]
      );
      return rows[0]?.def ?? '';
    };
    const fnCreate = await dump('create_invite');
    const fnGet    = await dump('get_invite_by_token');
    const fnAccept = await dump('accept_invite');

    const checks: [string, boolean][] = [
      ['create_invite: null/0 → never branch',          /p_expires_in_hours is null or p_expires_in_hours <= 0/i.test(fnCreate)],
      ['get_invite_by_token: null-aware expiry guard',  /v_invite\.expires_at is not null and v_invite\.expires_at <= now\(\)/i.test(fnGet)],
      ['accept_invite: null-aware expiry guard',        /v_invite\.expires_at is not null and v_invite\.expires_at <= now\(\)/i.test(fnAccept)],
    ];
    for (const [label, ok] of checks) {
      console.log(`[fn] ${label} → ${ok ? 'OK' : 'MISSING'}`);
      if (!ok) fails++;
    }

    if (fails > 0) {
      console.error(`\n❌ ${fails} check(s) failed.`);
      process.exit(1);
    }
    console.log(`\n✅ All checks passed.`);
  } finally {
    if (createdTokens.length) {
      await c.query(`delete from public.invites where token = any($1::text[]);`, [createdTokens]);
    }
    await c.end();
  }
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
