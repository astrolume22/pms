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
        subject: `You're invited to PMS`,
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
  const sysFont = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
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
  <title>You're invited to PMS</title>
</head>
<body style="margin:0; padding:0; background:#F2F4F8; font-family:${sysFont}; color:#1F2440;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F2F4F8; padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="520" style="max-width:520px; width:100%; background:#FFFFFF; border-radius:14px; box-shadow:0 4px 24px rgba(24,27,52,0.08);">
          <tr>
            <td style="padding:32px 40px 8px 40px; text-align:left;">
              <span style="display:inline-block; font-size:20px; font-weight:700; letter-spacing:0.04em; color:#0073EA;">PMS</span>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 40px 0 40px;">
              <h1 style="margin:0 0 12px 0; font-size:22px; line-height:28px; font-weight:700; color:#1F2440;">You've been invited</h1>
              <p style="margin:0 0 24px 0; font-size:15px; line-height:22px; color:#4A5074;">
                ${inviter} invited you to join <strong style="color:#1F2440;">${board}</strong> on PMS as ${article} <strong style="color:#1F2440;">${r}</strong>.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 8px 40px;">
              <a href="${u}" style="display:inline-block; background:#0073EA; color:#FFFFFF; font-size:15px; font-weight:600; text-decoration:none; padding:12px 22px; border-radius:8px;">Accept invite</a>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px 0 40px;">
              <p style="margin:0; font-size:12px; line-height:18px; color:#7B8198;">
                Or paste this link into your browser:<br />
                <a href="${u}" style="color:#0073EA; word-break:break-all;">${u}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 40px 32px 40px;">
              <p style="margin:24px 0 0 0; font-size:11px; line-height:16px; color:#9BA1C2; text-align:center; border-top:1px solid #E6E9EF; padding-top:18px;">
                If you weren't expecting this, you can safely ignore this email.<br />
                &copy; ${year} PMS
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
  return `You've been invited

${inviterName} invited you to join ${boardName} on PMS as ${article} ${role}.

Accept invite: ${url}

If you weren't expecting this, you can safely ignore this email.

(c) ${new Date().getFullYear()} PMS`;
}
