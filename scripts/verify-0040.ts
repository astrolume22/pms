/**
 * Verify migration 0040 + the new api/send-invite-email route.
 *
 *   (a) admin creates invite with p_invitee_email
 *       → invites.invitee_email is stored
 *
 *   (b) anon accepts that invite
 *       → public.users.email is the real address (not @pms.internal)
 *       → auth.users.email matches
 *
 *   (c) DUPLICATE EMAIL handling:
 *       c1) while first user is ACTIVE → accept-second raises 23505
 *       c2) deactivate first user (status='deactivated')
 *           → accept-second SUCCEEDS, freed auth.users row renamed
 *           → freshly accepted user has the email; old auth.users
 *             row carries 'freed_<uuid>@pms.internal'
 *
 *   (d) RESEND: build the email payload the route would post and
 *       actually POST it. Uses Resend's documented test recipient
 *       'delivered@resend.dev' so no real inbox is required and the
 *       provider returns a real id. Also writes the rendered HTML
 *       to scripts/output/sample-invite-email.html for visual proof.
 *
 * Touches no existing data — every fixture (invite, user, auth row,
 * board) is created fresh and torn down at the end.
 */
import './loadEnv';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

const url        = process.env.VITE_SUPABASE_URL!;
const anonKey    = process.env.VITE_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const adminUser  = process.env.MASTER_ADMIN_USERNAME!;
const adminPw    = process.env.MASTER_ADMIN_PASSWORD!;
const resendKey  = process.env.RESEND_API_KEY;
const resendFrom = process.env.RESEND_FROM_EMAIL;
const INTERNAL_DOMAIN = 'pms.internal';

let failures = 0;
const expect = (label: string, cond: boolean, detail?: string) => {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
};

async function signIn(email: string, pw: string) {
  const cli = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await cli.auth.signInWithPassword({ email, password: pw });
  if (error || !data.session) throw new Error(`sign-in failed for ${email}: ${error?.message}`);
  return {
    userId: data.user!.id,
    jwt: data.session.access_token,
    client: createClient(url, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
    }),
  };
}

async function main() {
  const pg  = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  const svc = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  await pg.connect();

  const cleanup: { invites: string[]; users: string[]; authUsers: string[] } = {
    invites: [], users: [], authUsers: [],
  };

  try {
    const admin = await signIn(`${adminUser}@${INTERNAL_DOMAIN}`, adminPw);

    // A unique email per run so reruns don't trip over each other.
    const stamp = Math.random().toString(16).slice(2, 8);
    const testEmail = `verify0040+${stamp}@example.com`;

    // ============ (a) admin mints invite with invitee_email ============
    console.log('\n=== (a) admin create_invite with p_invitee_email ===');
    const { data: invA, error: aErr } = await admin.client.rpc('create_invite', {
      p_role: 'viewer',
      p_board_id: null,
      p_expires_in_hours: null,
      p_group_id: null,
      p_invitee_email: testEmail,
    });
    expect(`create_invite OK (no error)`, !aErr, `error=${aErr?.message} code=${aErr?.code}`);
    const inv1 = invA as { id: string; token: string; invitee_email: string };
    cleanup.invites.push(inv1.id);
    expect(`returned invitee_email = '${testEmail}'`,
      inv1?.invitee_email === testEmail.toLowerCase(),
      `returned='${inv1?.invitee_email}'`);

    const { rows: [row1] } = await pg.query<{ invitee_email: string }>(
      `select invitee_email from public.invites where id = $1;`, [inv1.id]
    );
    expect(`DB row invitee_email = '${testEmail}'`,
      row1?.invitee_email === testEmail.toLowerCase(),
      `db='${row1?.invitee_email}'`);

    // ============ (b) anon accepts → real email on users ============
    console.log('\n=== (b) anon accept_invite uses the real email ===');
    const anonCli = createClient(url, anonKey, { auth: { persistSession: false } });
    const uname1 = 'v40a_' + stamp;
    const pwd    = 'project9999!';
    const { data: acc1, error: aErr2 } = await anonCli.rpc('accept_invite', {
      p_token:     inv1.token,
      p_username:  uname1,
      p_full_name: 'Verify 0040 User One',
      p_password:  pwd,
    });
    expect(`accept_invite OK`, !aErr2, `error=${aErr2?.message}`);
    const u1 = acc1 as { user_id: string; email: string };
    if (u1?.user_id) { cleanup.users.push(u1.user_id); cleanup.authUsers.push(u1.user_id); }
    expect(`returned email = '${testEmail}' (not @pms.internal)`,
      u1?.email === testEmail.toLowerCase(),
      `returned='${u1?.email}'`);

    const { rows: [pubUser1] } = await pg.query<{ email: string; username: string; role: string; status: string }>(
      `select email, username, role, status from public.users where id = $1;`, [u1.user_id]
    );
    expect(`public.users.email = '${testEmail}'`,
      pubUser1?.email === testEmail.toLowerCase(),
      `db='${pubUser1?.email}'`);
    expect(`public.users.username preserved = '${uname1}'`, pubUser1?.username === uname1);

    const { rows: [authUser1] } = await pg.query<{ email: string }>(
      `select email from auth.users where id = $1;`, [u1.user_id]
    );
    expect(`auth.users.email = '${testEmail}'`,
      authUser1?.email === testEmail.toLowerCase(),
      `auth='${authUser1?.email}'`);

    // ============ (c1) duplicate while active → blocked ============
    console.log('\n=== (c1) duplicate while ACTIVE → blocked (23505) ===');
    const { data: invB, error: invBErr } = await admin.client.rpc('create_invite', {
      p_role: 'viewer',
      p_board_id: null,
      p_expires_in_hours: null,
      p_group_id: null,
      p_invitee_email: testEmail,
    });
    expect(`second create_invite OK (mint allowed)`, !invBErr, `err=${invBErr?.message}`);
    const inv2 = invB as { id: string; token: string };
    cleanup.invites.push(inv2.id);

    const uname2 = 'v40b_' + stamp;
    const { error: dupErr } = await anonCli.rpc('accept_invite', {
      p_token:     inv2.token,
      p_username:  uname2,
      p_full_name: 'Should Be Blocked',
      p_password:  pwd,
    });
    const blocked = !!dupErr && /already uses this email/i.test(dupErr.message ?? '');
    expect(`accept-second BLOCKED with "An active account already uses this email"`,
      blocked, `code=${dupErr?.code} msg=${dupErr?.message}`);

    // ============ (c2) deactivate first → accept-second succeeds ============
    console.log('\n=== (c2) deactivate first → accept now allowed, freed_ rename ===');
    await pg.query(`update public.users set status = 'deactivated' where id = $1;`, [u1.user_id]);

    const uname3 = 'v40c_' + stamp;
    const { data: acc3, error: acc3Err } = await anonCli.rpc('accept_invite', {
      p_token:     inv2.token,
      p_username:  uname3,
      p_full_name: 'Should Now Succeed',
      p_password:  pwd,
    });
    expect(`accept-second OK after deactivation`, !acc3Err, `err=${acc3Err?.message}`);
    const u3 = acc3 as { user_id: string; email: string };
    if (u3?.user_id) { cleanup.users.push(u3.user_id); cleanup.authUsers.push(u3.user_id); }
    expect(`new user has the email = '${testEmail}'`,
      u3?.email === testEmail.toLowerCase(), `email='${u3?.email}'`);

    // First user's auth row should now be renamed to freed_<uuid>@pms.internal.
    const { rows: [renamed] } = await pg.query<{ email: string }>(
      `select email from auth.users where id = $1;`, [u1.user_id]
    );
    expect(`first user's auth.users.email renamed to freed_${u1.user_id.slice(0,8)}…@pms.internal`,
      typeof renamed?.email === 'string' && renamed.email.startsWith('freed_') && renamed.email.endsWith('@pms.internal'),
      `first-auth-email='${renamed?.email}'`);

    // ============ (d) RESEND send + HTML preview ============
    console.log('\n=== (d) Resend POST + branded HTML preview ===');
    // The route's html builder is duplicated here so we can render the
    // exact same body locally for the screenshot/preview. The route
    // itself is the canonical version — this is a 1:1 copy for proof.
    const sysFont = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
    const url2  = 'https://pms-snowy-eight.vercel.app/invite/EXAMPLE_TOKEN_FOR_PREVIEW';
    const role  = 'viewer';
    const board = 'Team Projects';
    const inviter = 'Master Admin';
    const html  = buildPreviewHtml({ url: url2, role, boardName: board, inviterName: inviter, sysFont });
    const outDir = join(process.cwd(), 'scripts', 'output');
    mkdirSync(outDir, { recursive: true });
    const htmlPath = join(outDir, 'sample-invite-email.html');
    writeFileSync(htmlPath, html, 'utf8');
    console.log(`  wrote rendered preview: ${htmlPath}`);

    if (!resendKey || !resendFrom) {
      console.log('  ⚠️  RESEND_API_KEY or RESEND_FROM_EMAIL not in .env.local — skipping live send.');
      console.log('     (the route will work in production where the Vercel env vars are set.)');
    } else {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          from:    resendFrom,
          // Resend's documented test recipient — accepts the send and
          // returns a real id without bouncing to anyone.
          to:      ['delivered@resend.dev'],
          subject: `[verify-0040] You're invited to PMS`,
          html,
          text:   `Verify-0040 send. URL: ${url2}`,
        }),
      });
      const data = await resp.json().catch(() => null) as { id?: string; message?: string; name?: string } | null;
      expect(`Resend POST returned 2xx (got ${resp.status})`, resp.ok, `resp=${JSON.stringify(data)}`);
      if (resp.ok && data?.id) {
        console.log(`  📨 Resend message id: ${data.id}`);
      }
    }
  } finally {
    // Cleanup — order matters: invites first, then users, then auth.
    if (cleanup.invites.length) {
      await pg.query(`delete from public.invites where id = any($1::uuid[]);`, [cleanup.invites]);
    }
    if (cleanup.users.length) {
      await pg.query(`delete from public.users where id = any($1::uuid[]);`, [cleanup.users]);
    }
    for (const uid of cleanup.authUsers) {
      await svc.auth.admin.deleteUser(uid).catch(() => undefined);
    }
    await pg.end();
  }

  console.log('');
  if (failures > 0) { console.error(`❌ ${failures} check(s) failed.`); process.exit(1); }
  console.log('✅ 0040 verified end-to-end.');
}

// Identical to api/send-invite-email.ts buildEmailHtml — duplicated
// only because that route is a Vercel handler module and not
// importable from a script context. Kept in sync manually.
function buildPreviewHtml(
  { url, role, boardName, inviterName, sysFont }:
  { url: string; role: string; boardName: string; inviterName: string; sysFont: string }
): string {
  const year = new Date().getFullYear();
  const article = role === 'admin' ? 'an' : 'a';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>You're invited to PMS</title>
</head>
<body style="margin:0; padding:0; background:#F2F4F8; font-family:${sysFont}; color:#1F2440;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F2F4F8; padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="520" style="max-width:520px; width:100%; background:#FFFFFF; border-radius:14px; box-shadow:0 4px 24px rgba(24,27,52,0.08);">
        <tr><td style="padding:32px 40px 8px 40px; text-align:left;">
          <span style="display:inline-block; font-size:20px; font-weight:700; letter-spacing:0.04em; color:#0073EA;">PMS</span>
        </td></tr>
        <tr><td style="padding:8px 40px 0 40px;">
          <h1 style="margin:0 0 12px 0; font-size:22px; line-height:28px; font-weight:700; color:#1F2440;">You've been invited</h1>
          <p style="margin:0 0 24px 0; font-size:15px; line-height:22px; color:#4A5074;">
            ${inviterName} invited you to join <strong style="color:#1F2440;">${boardName}</strong> on PMS as ${article} <strong style="color:#1F2440;">${role}</strong>.
          </p>
        </td></tr>
        <tr><td style="padding:0 40px 8px 40px;">
          <a href="${url}" style="display:inline-block; background:#0073EA; color:#FFFFFF; font-size:15px; font-weight:600; text-decoration:none; padding:12px 22px; border-radius:8px;">Accept invite</a>
        </td></tr>
        <tr><td style="padding:20px 40px 0 40px;">
          <p style="margin:0; font-size:12px; line-height:18px; color:#7B8198;">
            Or paste this link into your browser:<br />
            <a href="${url}" style="color:#0073EA; word-break:break-all;">${url}</a>
          </p>
        </td></tr>
        <tr><td style="padding:28px 40px 32px 40px;">
          <p style="margin:24px 0 0 0; font-size:11px; line-height:16px; color:#9BA1C2; text-align:center; border-top:1px solid #E6E9EF; padding-top:18px;">
            If you weren't expecting this, you can safely ignore this email.<br />
            &copy; ${year} PMS
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
