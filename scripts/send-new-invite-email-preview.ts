/**
 * Render the new EIA-branded invite email HTML (the SAME template that
 * api/send-invite-email.ts now produces) and POST it directly to Resend
 * for a real one-shot send to delivered@resend.dev. This sidesteps the
 * Vercel deploy lag so we can prove the redesign right now.
 *
 * NOT a substitute for the actual route at run time — the route's
 * admin-only JWT gate + Resend env handling are still the source of
 * truth. This is a render+send preview only.
 */
import './loadEnv';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const APP_ORIGIN = 'https://p-m-system.vercel.app';
const TO = 'delivered@resend.dev';

// ----- mirror api/send-invite-email.ts ----------------------------------
function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
interface EmailParams { url: string; role: string; boardName: string; inviterName: string }

function buildEmailHtml({ url, role, boardName, inviterName }: EmailParams): string {
  const SERIF    = "'Cormorant Garamond', Georgia, 'Times New Roman', 'Times', serif";
  const SYS_SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
  const NAVY   = '#1a2547';
  const CREAM  = '#FAF8F3';
  const GOLD   = '#b08d57';
  const MUTED  = '#6B7280';
  const BORDER = '#ECE7DA';
  const year = new Date().getFullYear();
  const article = role === 'admin' ? 'an' : 'a';
  const r = escapeHtml(role);
  const inviter = escapeHtml(inviterName);
  const board   = escapeHtml(boardName);
  const u       = escapeHtml(url);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>You've been invited to EIA Projects</title>
</head>
<body style="margin:0; padding:0; background:${CREAM}; font-family:${SYS_SANS}; color:${NAVY};">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${CREAM}; padding:48px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="520" style="max-width:520px; width:100%; background:#FFFFFF; border:1px solid ${BORDER}; border-radius:12px; box-shadow:0 10px 40px -16px rgba(26,37,71,0.18), 0 2px 6px -2px rgba(26,37,71,0.06);">
          <tr>
            <td style="padding:40px 40px 0 40px; text-align:center;">
              <div style="font-family:${SERIF}; font-weight:500; color:${NAVY}; font-size:56px; line-height:1; letter-spacing:0.08em;">EIA</div>
              <div style="font-family:${SERIF}; font-weight:500; color:${NAVY}; font-size:17px; letter-spacing:0.02em; margin-top:10px;">Expert Intuitive Advisor</div>
              <div style="font-style:italic; color:${MUTED}; font-size:11px; letter-spacing:0.2em; text-transform:uppercase; margin-top:14px;">The intelligence layer between humans and AI.</div>
              <div style="width:60px; height:2px; background:${GOLD}; margin:20px auto 0; border-radius:1px; line-height:2px; font-size:0;">&nbsp;</div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px 0 40px; text-align:center;">
              <h1 style="margin:0 0 12px 0; font-family:${SYS_SANS}; font-size:20px; line-height:28px; font-weight:700; color:${NAVY};">You've been invited to EIA Projects</h1>
              <p style="margin:0; font-family:${SYS_SANS}; font-size:15px; line-height:23px; color:${NAVY};">
                ${inviter} has invited you to join <strong style="color:${NAVY};">${board}</strong> as ${article} <strong style="color:${NAVY};">${r}</strong>.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 40px 8px 40px; text-align:center;">
              <a href="${u}" style="display:inline-block; background:${NAVY}; color:#FFFFFF; font-family:${SYS_SANS}; font-size:15px; font-weight:700; letter-spacing:0.02em; text-decoration:none; padding:14px 28px; border-radius:8px;">Accept Invitation</a>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 40px 0 40px; text-align:center;">
              <p style="margin:0; font-family:${SYS_SANS}; font-size:12px; line-height:18px; color:${MUTED};">
                Or paste this link into your browser:<br />
                <a href="${u}" style="color:${NAVY}; word-break:break-all; text-decoration:underline;">${u}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px 40px 40px;">
              <p style="margin:24px 0 0 0; font-family:${SYS_SANS}; font-size:11px; line-height:17px; color:${MUTED}; text-align:center; border-top:1px solid ${BORDER}; padding-top:20px;">
                If you weren't expecting this, you can safely ignore this email.<br />
                &copy; ${year} Expert Intuitive Advisor Inc.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildEmailText({ url, role, boardName, inviterName }: EmailParams): string {
  const article = role === 'admin' ? 'an' : 'a';
  return `EIA Projects — You've been invited

${inviterName} has invited you to join ${boardName} on EIA Projects as ${article} ${role}.

Accept your invitation: ${url}

If you weren't expecting this, you can safely ignore this email.

The intelligence layer between humans and AI.
(c) ${new Date().getFullYear()} Expert Intuitive Advisor Inc.`;
}

// ----- send ---------------------------------------------------------------
async function main() {
  const key = process.env.RESEND_API_KEY!;
  const from = process.env.RESEND_FROM_EMAIL!;
  if (!key || !from) {
    console.error('Missing RESEND_API_KEY or RESEND_FROM_EMAIL');
    process.exit(1);
  }
  const url = APP_ORIGIN + '/invite/EXAMPLE_PREVIEW_TOKEN';
  const html = buildEmailHtml({ url, role: 'manager', boardName: 'Team Projects', inviterName: 'Master Admin' });
  const text = buildEmailText({ url, role: 'manager', boardName: 'Team Projects', inviterName: 'Master Admin' });

  // Snapshot the rendered HTML next to scripts/output/ for reference.
  writeFileSync(
    join(process.cwd(), 'scripts', 'output', 'sample-invite-email-eia.html'),
    html,
    'utf8',
  );

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [TO],
      subject: "You've been invited to EIA Projects",
      html,
      text,
    }),
  });
  const body = await resp.json().catch(() => null) as { id?: string; message?: string } | null;
  console.log('Resend status: ' + resp.status);
  console.log('Resend body:   ' + JSON.stringify(body));
  if (!resp.ok) process.exit(1);
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
