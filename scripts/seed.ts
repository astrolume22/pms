/**
 * Idempotent seed for Phase 1:
 *   • 1 account row
 *   • 1 main workspace
 *   • 4 users (admin + pm1/pm2/pm3) via Supabase Auth Admin API
 *   • 4 workspace_members
 *
 * Re-running is safe — every step uses upsert / "if not exists" logic.
 * Requires SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL +
 * MASTER_ADMIN_USERNAME + MASTER_ADMIN_PASSWORD in .env.local.
 */
import './loadEnv';
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminUsername = process.env.MASTER_ADMIN_USERNAME;
const adminPassword = process.env.MASTER_ADMIN_PASSWORD;

if (!url || !serviceKey || !adminUsername || !adminPassword) {
  console.error('Missing one of: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MASTER_ADMIN_USERNAME, MASTER_ADMIN_PASSWORD');
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const INTERNAL_DOMAIN = 'pms.internal';
const internalEmail = (username: string) => `${username}@${INTERNAL_DOMAIN}`;

interface UserSpec {
  username: string;
  password: string;
  full_name: string;
  role: 'admin' | 'manager' | 'viewer';
  is_super_admin: boolean;
  title: string | null;
}

const users: UserSpec[] = [
  { username: adminUsername, password: adminPassword, full_name: 'Master Admin',  role: 'admin',   is_super_admin: true,  title: 'Super Admin'    },
  { username: 'pm1',         password: 'project123!', full_name: 'Project Manager 1', role: 'manager', is_super_admin: false, title: 'Project Manager' },
  { username: 'pm2',         password: 'project123!', full_name: 'Project Manager 2', role: 'manager', is_super_admin: false, title: 'Project Manager' },
  { username: 'pm3',         password: 'project123!', full_name: 'Project Manager 3', role: 'manager', is_super_admin: false, title: 'Project Manager' },
];

async function seedAccount(): Promise<void> {
  // Single-row account.  Create only if not already present.
  const { data: existing } = await admin.from('account').select('id').limit(1);
  if (existing && existing.length > 0) {
    console.log('  account: exists');
    return;
  }
  const { error } = await admin.from('account').insert({ name: 'PMS' });
  if (error) throw error;
  console.log('  account: created');
}

async function seedWorkspace(): Promise<string> {
  const { data: existing, error: selErr } = await admin
    .from('workspaces')
    .select('id, name')
    .eq('is_main', true)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing) {
    console.log(`  workspace: exists (${existing.id})`);
    return existing.id as string;
  }
  const { data: inserted, error } = await admin
    .from('workspaces')
    .insert({ name: 'Main workspace', is_main: true, icon_emoji: '🏠', icon_color: '#0073EA' })
    .select('id')
    .single();
  if (error) throw error;
  console.log(`  workspace: created (${inserted.id})`);
  return inserted.id as string;
}

async function findAuthUserByEmail(email: string) {
  // Auth Admin API doesn't expose getUserByEmail — list and filter.
  let page = 1;
  const perPage = 200;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (data.users.length < perPage) return null;
    page += 1;
  }
}

async function seedUser(spec: UserSpec, workspaceId: string): Promise<void> {
  const email = internalEmail(spec.username);

  // 1. Auth user
  let authUser = await findAuthUserByEmail(email);
  if (!authUser) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: spec.password,
      email_confirm: true,
      user_metadata: { username: spec.username, full_name: spec.full_name },
    });
    if (error) throw error;
    authUser = data.user;
    console.log(`  user ${spec.username}: auth created (${authUser!.id})`);
  } else {
    // Make sure the password matches what's documented (so re-running fixes drift).
    await admin.auth.admin.updateUserById(authUser.id, { password: spec.password });
    console.log(`  user ${spec.username}: auth exists (${authUser.id}) — password reset to seed value`);
  }

  // 2. public.users row (upsert by id)
  const profile = {
    id: authUser!.id,
    email,
    username: spec.username,
    full_name: spec.full_name,
    role: spec.role,
    status: 'active' as const,
    is_super_admin: spec.is_super_admin,
    theme: 'light' as const,
    timezone: 'UTC',
    title: spec.title,
  };
  const { error: upErr } = await admin.from('users').upsert(profile, { onConflict: 'id' });
  if (upErr) throw upErr;

  // 3. workspace_members (upsert)
  const memberRow = {
    workspace_id: workspaceId,
    user_id: authUser!.id,
    role: (spec.role === 'admin' ? 'owner' : 'member') as 'owner' | 'member' | 'viewer',
  };
  const { error: memErr } = await admin
    .from('workspace_members')
    .upsert(memberRow, { onConflict: 'workspace_id,user_id' });
  if (memErr) throw memErr;
}

async function seedAdminSecrets(): Promise<void> {
  // Phase 6 — store the service-role key + project URL so the
  // admin_create_user / admin_reset_password Postgres functions can
  // call the GoTrue admin endpoint via pg_net without ever exposing
  // the key to the browser.
  //
  // The set_admin_secrets RPC is super-admin only — but the seed runs
  // with the service-role JWT (which bypasses RLS), so we sign in via
  // a Postgres function call directly. The easiest path is to use the
  // service-role client's .rpc method.
  const { error } = await admin.rpc('set_admin_secrets', {
    p_key: serviceKey!,
    p_url: url!,
  });
  if (error) {
    // If the RPC doesn't exist yet (migration 0018 not applied), warn
    // but don't fail — the user might re-run after migrating.
    if (/function|does not exist/i.test(error.message)) {
      console.warn(
        '  admin secrets: set_admin_secrets() not found — re-run `npm run migrate` and then `npm run seed` again',
      );
      return;
    }
    throw error;
  }
  console.log('  admin secrets: stored service_role_key + supabase_url');
}

async function main() {
  console.log('Seeding Phase 1 data...');
  await seedAccount();
  const wsId = await seedWorkspace();
  for (const u of users) await seedUser(u, wsId);
  await seedAdminSecrets();
  console.log('\n✅ Seed complete.');
}

main().catch((err) => {
  console.error('\n❌ Seed failed:', err);
  process.exit(1);
});
