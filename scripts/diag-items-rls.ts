/**
 * End-to-end RLS repro: sign in as the actual manager user via the
 * Supabase auth REST API, then PATCH /rest/v1/items?id=eq.<X> with
 * Prefer: return=minimal and {"deleted_at":"now"} — exactly what the
 * db.ts soft-delete path does. Capture the PostgREST status + body.
 */
import './loadEnv';
import { Client } from 'pg';

const SUPABASE_URL  = process.env.VITE_SUPABASE_URL!;
const ANON_KEY      = process.env.VITE_SUPABASE_ANON_KEY!;

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();

  // Pick a manager + a board they subscribe to + a live row on it.
  const { rows: [mgr] } = await c.query<{
    id: string; username: string; email: string; board_id: string;
  }>(`
    select u.id, u.username, u.email, bs.board_id
      from public.users u
      join public.board_subscribers bs on bs.user_id = u.id
     where u.status = 'active'
       and u.role = 'manager'
       and u.is_super_admin = false
     order by u.username
     limit 1
  `);
  console.log('manager actor:', mgr);

  const { rows: [admin] } = await c.query<{ id: string; username: string; email: string }>(`
    select id, username, email from public.users
     where role = 'admin' and status = 'active' limit 1
  `);
  console.log('admin actor  :', admin);

  const { rows: [victim] } = await c.query<{ id: string; name: string }>(`
    select id, name from public.items
     where board_id = $1 and deleted_at is null
     limit 1
  `, [mgr.board_id]);
  console.log('victim row   :', victim);

  // Help — what does items_update WITH CHECK look like (for the record)?
  const { rows: pols } = await c.query<{ polname: string; cmd: string; qual: string | null; wc: string | null }>(`
    select policyname as polname, cmd, qual, with_check as wc
      from pg_policies where schemaname='public' and tablename='items'
  `);
  console.log('\npg_policies items_update:',
    pols.find((p) => p.polname === 'items_update'));
  console.log('pg_policies items_select:',
    pols.find((p) => p.polname === 'items_select'));

  await c.end();

  // ---- helper: sign in via Supabase auth REST and return access_token ----
  async function signIn(email: string, password: string): Promise<string | null> {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const body = await r.text();
    if (!r.ok) { console.error('signIn fail:', r.status, body); return null; }
    return (JSON.parse(body) as { access_token: string }).access_token;
  }

  // ---- helper: do the PATCH the way db.ts does it ----
  async function patchItem(token: string, itemId: string, patch: object) {
    const url = `${SUPABASE_URL}/rest/v1/items?id=eq.${itemId}`;
    const r = await fetch(url, {
      method: 'PATCH',
      headers: {
        'apikey': ANON_KEY,
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(patch),
    });
    const text = await r.text();
    return { status: r.status, body: text };
  }

  // Try a known dev password for the seed users. If unset / wrong, just
  // log the response — we still get to see the auth refusal vs the RLS
  // 42501.
  const DEV_PW = process.env.PMS_DEV_PASSWORD ?? 'admin1234';

  // Soft-delete as MANAGER (the failing path the founder reported).
  console.log('\n=== PATCH /rest/v1/items?id=eq.<v> Prefer:return=minimal {deleted_at:now} as MANAGER ===');
  const mgrTok = await signIn(mgr.email, DEV_PW);
  if (mgrTok) {
    const r = await patchItem(mgrTok, victim.id, { deleted_at: new Date().toISOString() });
    console.log('  status =', r.status);
    console.log('  body   =', r.body);
  }

  // Same as ADMIN — should succeed.
  console.log('\n=== same PATCH as ADMIN ===');
  const adminTok = await signIn(admin.email, DEV_PW);
  if (adminTok) {
    const r = await patchItem(adminTok, victim.id, { deleted_at: new Date().toISOString() });
    console.log('  status =', r.status);
    console.log('  body   =', r.body);
    // Undo so we don't permanently soft-delete.
    if (r.status === 204) {
      const u = await patchItem(adminTok, victim.id, { deleted_at: null });
      console.log('  undo status =', u.status);
    }
  }
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
