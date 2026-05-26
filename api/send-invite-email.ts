/**
 * POST /api/send-invite-email
 *
 * Emails the invite link to the invitee via Resend. The invite row
 * itself is created by the frontend via the create_invite() RPC;
 * this route just (a) admin-gates the caller, (b) builds the magic
 * link from the request origin, and (c) POSTs a branded HTML email
 * to Resend.
 *
 * Mirrors the api/ai-build.ts pattern:
 *   • top-level try/catch → JSON 500
 *   • CORS headers
 *   • JWT auth via the caller's Bearer token (RLS gates is_admin())
 *   • secrets via process.env.X with the "not configured" 500-guard
 *
 * Body: { token, invitee_email, board_name?, role?, inviter_name? }
 * 200:  { sent: true, id }
 * 4xx/5xx: { error, resend? }
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

interface SendBody {
  token:          string;
  invitee_email:  string;
  board_name?:    string;
  role?:          'admin' | 'manager' | 'viewer';
  inviter_name?:  string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS (same as ai-build.ts).
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ error: 'method not allowed' }); return; }

  try {
    // --- secrets ---
    const resendKey       = process.env.RESEND_API_KEY;
    const resendFrom      = process.env.RESEND_FROM_EMAIL;
    const supabaseUrl     = process.env.SUPABASE_URL      ?? process.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;

    if (!resendKey)  { res.status(500).json({ error: 'RESEND_API_KEY not configured on server' });   return; }
    if (!resendFrom) { res.status(500).json({ error: 'RESEND_FROM_EMAIL not configured on server' }); return; }
    if (!supabaseUrl || !supabaseAnonKey) {
      res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_ANON_KEY not configured on server' });
      return;
    }

    // --- auth ---
    const authHeader = req.headers.authorization ?? '';
    const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!jwt) { res.status(401).json({ error: 'missing Authorization: Bearer <token>' }); return; }

    const sb = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userResp, error: userErr } = await sb.auth.getUser(jwt);
    if (userErr || !userResp?.user) {
      res.status(401).json({ error: 'invalid session token' });
      return;
    }

    // Admin gate via is_admin() RPC (server-side check, JWT-bound).
    const { data: isAdmin, error: adminErr } = await sb.rpc('is_admin');
    if (adminErr)  { res.status(401).json({ error: `auth check failed: ${adminErr.message}` }); return; }
    if (!isAdmin)  { res.status(403).json({ error: 'admins only' }); return; }

    // --- body ---
    const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) as Partial<SendBody>;
    const token          = typeof body?.token === 'string' ? body.token : '';
    const invitee_email  = typeof body?.invitee_email === 'string' ? body.invitee_email.trim() : '';
    const board_name     = typeof body?.board_name === 'string' ? body.board_name : '';
    const role           = body?.role && /^(admin|manager|viewer)$/.test(body.role) ? body.role : 'manager';
    const inviter_name   = typeof body?.inviter_name === 'string' ? body.inviter_name : '';

    if (!token)                                       { res.status(400).json({ error: 'token required' }); return; }
    if (!invitee_email || !/^.+@.+\..+$/.test(invitee_email)) {
      res.status(400).json({ error: 'invitee_email required and must look like an email' });
      return;
    }

    // --- build invite URL from request origin ---
    const proto    = (req.headers['x-forwarded-proto'] as string) || 'https';
    const host     = (req.headers['x-forwarded-host'] as string)
                  || (req.headers.host as string)
                  || '';
    const origin   = (req.headers.origin as string) || (host ? `${proto}://${host}` : '');
    if (!origin) { res.status(500).json({ error: 'cannot determine request origin' }); return; }
    const inviteUrl = `${origin}/invite/${encodeURIComponent(token)}`;

    // --- email payload ---
    const safeBoard   = board_name   ? board_name.slice(0, 120) : 'a workspace';
    const safeInviter = inviter_name ? inviter_name.slice(0, 120) : 'An admin';
    const html = buildEmailHtml({ url: inviteUrl, role, boardName: safeBoard, inviterName: safeInviter });
    const text = buildEmailText({ url: inviteUrl, role, boardName: safeBoard, inviterName: safeInviter });

    // --- POST to Resend ---
    const resendResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    resendFrom,
        to:      [invitee_email],
        subject: `You've been invited to EIA Projects`,
        html,
        text,
      }),
    });
    const resendData = await resendResp.json().catch(() => null) as { id?: string; message?: string; name?: string } | null;
    if (!resendResp.ok) {
      // Surface Resend's error verbatim so the frontend can toast it.
      res.status(resendResp.status).json({ error: 'resend api error', resend: resendData });
      return;
    }
    res.status(200).json({ sent: true, id: resendData?.id ?? null });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
}

// =====================================================================
// Email HTML — premium, clean, system-font. Inline CSS only.
// Max width 520px so it reads well on mobile and desktop.
// =====================================================================

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

interface EmailParams { url: string; role: string; boardName: string; inviterName: string }

function buildEmailHtml({ url, role, boardName, inviterName }: EmailParams): string {
  // Email clients won't load remote fonts (no @import / @font-face).
  // Fall back to a serif stack that ships on every major OS so the
  // EIA wordmark still reads as serif even where Cormorant isn't
  // available. Body text is system-sans, mirroring the login page.
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
  <!-- Mobile-friendly outer table: cream background, generous padding, center -->
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${CREAM}; padding:48px 16px;">
    <tr>
      <td align="center">
        <!-- White card. Max-width 520px so it reads cleanly on phone + desktop. -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="520" style="max-width:520px; width:100%; background:#FFFFFF; border:1px solid ${BORDER}; border-radius:12px; box-shadow:0 10px 40px -16px rgba(26,37,71,0.18), 0 2px 6px -2px rgba(26,37,71,0.06);">
          <!-- EIA brand block (centered): serif wordmark + company name + italic tagline + gold divider -->
          <tr>
            <td style="padding:40px 40px 0 40px; text-align:center;">
              <div style="font-family:${SERIF}; font-weight:500; color:${NAVY}; font-size:56px; line-height:1; letter-spacing:0.08em;">EIA</div>
              <div style="font-family:${SERIF}; font-weight:500; color:${NAVY}; font-size:17px; letter-spacing:0.02em; margin-top:10px;">Expert Intuitive Advisor</div>
              <div style="font-style:italic; color:${MUTED}; font-size:11px; letter-spacing:0.2em; text-transform:uppercase; margin-top:14px;">The intelligence layer between humans and AI.</div>
              <div style="width:60px; height:2px; background:${GOLD}; margin:20px auto 0; border-radius:1px; line-height:2px; font-size:0;">&nbsp;</div>
            </td>
          </tr>

          <!-- Heading + copy -->
          <tr>
            <td style="padding:32px 40px 0 40px; text-align:center;">
              <h1 style="margin:0 0 12px 0; font-family:${SYS_SANS}; font-size:20px; line-height:28px; font-weight:700; color:${NAVY};">You've been invited to EIA Projects</h1>
              <p style="margin:0; font-family:${SYS_SANS}; font-size:15px; line-height:23px; color:${NAVY};">
                ${inviter} has invited you to join <strong style="color:${NAVY};">${board}</strong> as ${article} <strong style="color:${NAVY};">${r}</strong>.
              </p>
            </td>
          </tr>

          <!-- Primary CTA — deep navy, full attention -->
          <tr>
            <td style="padding:28px 40px 8px 40px; text-align:center;">
              <a href="${u}" style="display:inline-block; background:${NAVY}; color:#FFFFFF; font-family:${SYS_SANS}; font-size:15px; font-weight:700; letter-spacing:0.02em; text-decoration:none; padding:14px 28px; border-radius:8px;">Accept Invitation</a>
            </td>
          </tr>

          <!-- Plain-text fallback link -->
          <tr>
            <td style="padding:18px 40px 0 40px; text-align:center;">
              <p style="margin:0; font-family:${SYS_SANS}; font-size:12px; line-height:18px; color:${MUTED};">
                Or paste this link into your browser:<br />
                <a href="${u}" style="color:${NAVY}; word-break:break-all; text-decoration:underline;">${u}</a>
              </p>
            </td>
          </tr>

          <!-- Footer note -->
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
