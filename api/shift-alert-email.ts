/**
 * POST /api/shift-alert-email
 *
 * Sends a shift-system email alert (85% checkpoint or period lock) via
 * Resend. Called fire-and-forget from the manager's browser when the
 * client-side idempotent guards in ShiftDriver fire ONCE per event:
 *
 *   - kind='85'   — to the MANAGER: "Check-in coming up".
 *   - kind='lock' — to the MANAGER and (CC equivalent: a second to)
 *                   the ADMIN/boss: "Account locked — call your sir".
 *
 * Auth: the caller must be authenticated as the session's own manager
 * OR an admin/super. Verified via Supabase JWT (Bearer access_token)
 * + auth.getUser — no leakable client-side secret.
 *
 * Idempotency: this endpoint does NOT dedupe. The caller (ShiftDriver)
 * is expected to send ONLY when the matching RPC returned a fresh
 * event (already_alerted=false / already_locked=false). Belt-and-
 * suspenders dedup can be added later via shift_events lookups if
 * misbehaving clients become a problem.
 *
 * Failure modes returned to caller (so the UI can log without breaking):
 *   200 { ok: true, recipients: [...], resend_ids: [...] }
 *   200 { ok: false, error: 'email not configured', missing: [...] }
 *   401 { ok: false, error: 'Unauthorized' }
 *   403 { ok: false, error: 'Forbidden — not session owner or admin' }
 *   400 { ok: false, error: 'invalid body' }
 *   500 { ok: false, error: '<message>' }
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

interface ReqBody {
  session_id?: unknown;
  kind?: unknown;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ResendResp {
  id?: string;
  message?: string;
}

async function sendResend(args: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  text: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: args.from,
        to: args.to,
        subject: args.subject,
        text: args.text,
      }),
    });
    const body = (await resp.json().catch(() => ({}))) as ResendResp;
    if (!resp.ok) {
      return { ok: false, error: `Resend ${resp.status}: ${body.message ?? 'unknown error'}` };
    }
    return { ok: true, id: body.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'fetch threw' };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Standard CORS preamble — this endpoint is intentionally same-origin
  // only in production (the manager's browser hits the same Vercel
  // origin), but the headers are cheap insurance against future
  // route-rewrite quirks.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Only POST is supported' }); return;
  }

  try {
    // ---- env / config ----
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
    const anonKey    = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !anonKey || !serviceKey) {
      res.status(500).json({ ok: false, error: 'SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY not configured' });
      return;
    }
    const resendKey  = process.env.RESEND_API_KEY;
    const resendFrom = process.env.RESEND_FROM_EMAIL;
    const adminAlertEmailEnv = process.env.ADMIN_ALERT_EMAIL?.trim() || null;

    // ---- auth: verify the caller's Supabase JWT ----
    const authHeader = req.headers.authorization ?? '';
    const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : '';
    if (!token) {
      res.status(401).json({ ok: false, error: 'Unauthorized — missing Bearer token' });
      return;
    }
    const verify = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
    const { data: userData, error: userErr } = await verify.auth.getUser(token);
    if (userErr || !userData.user) {
      res.status(401).json({ ok: false, error: 'Unauthorized — invalid token' });
      return;
    }
    const callerId = userData.user.id;

    // ---- parse + validate body ----
    let body: ReqBody;
    if (typeof req.body === 'string') {
      try { body = JSON.parse(req.body) as ReqBody; }
      catch { res.status(400).json({ ok: false, error: 'invalid body — not JSON' }); return; }
    } else if (req.body && typeof req.body === 'object') {
      body = req.body as ReqBody;
    } else {
      res.status(400).json({ ok: false, error: 'invalid body' }); return;
    }
    const sessionId = typeof body.session_id === 'string' ? body.session_id.trim() : '';
    const kind = typeof body.kind === 'string' ? body.kind : '';
    if (!UUID_RE.test(sessionId)
        || (kind !== '85'
            && kind !== 'lock'
            && kind !== 'bio_total_warn'
            && kind !== 'complete'
            && kind !== 'break_overstay_lock')) {
      res.status(400).json({ ok: false, error: 'invalid body — need session_id (uuid) and kind ("85"|"lock"|"bio_total_warn"|"complete"|"break_overstay_lock")' });
      return;
    }

    // ---- service-role queries: session, manager, admin recipient ----
    const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data: sess, error: sessErr } = await sb
      .from('shift_sessions')
      .select('id, user_id, mode, current_period_index, period_seconds, status, locked_reason')
      .eq('id', sessionId)
      .maybeSingle();
    if (sessErr) {
      res.status(500).json({ ok: false, error: `session lookup failed: ${sessErr.message}` });
      return;
    }
    if (!sess) { res.status(400).json({ ok: false, error: 'session not found' }); return; }

    // Authz: caller must be the session's user OR an admin/super.
    const { data: caller, error: cErr } = await sb
      .from('users')
      .select('id, role, is_super_admin, status')
      .eq('id', callerId)
      .maybeSingle();
    if (cErr || !caller) {
      res.status(403).json({ ok: false, error: 'Forbidden — caller profile not found' });
      return;
    }
    const callerIsAdmin = caller.role === 'admin' || caller.is_super_admin === true;
    if (callerId !== sess.user_id && !callerIsAdmin) {
      res.status(403).json({ ok: false, error: 'Forbidden — not session owner or admin' });
      return;
    }

    // Manager (the session owner).
    const { data: manager, error: mErr } = await sb
      .from('users')
      .select('id, email, full_name, username')
      .eq('id', sess.user_id)
      .maybeSingle();
    if (mErr || !manager?.email) {
      res.status(500).json({ ok: false, error: `manager lookup failed: ${mErr?.message ?? 'no row'}` });
      return;
    }
    const managerName = manager.full_name || manager.username || 'there';

    // Admin recipient (only needed for kind='lock'). Prefer the
    // ADMIN_ALERT_EMAIL env override so the founder can redirect alerts
    // to a personal address without rewriting their users row.
    let adminEmail: string | null = null;
    if (kind === 'lock' || kind === 'bio_total_warn' || kind === 'break_overstay_lock') {
      if (adminAlertEmailEnv) {
        adminEmail = adminAlertEmailEnv;
      } else {
        const { data: admins } = await sb
          .from('users')
          .select('email')
          .eq('role', 'admin')
          .eq('is_super_admin', true)
          .eq('status', 'active')
          .order('created_at', { ascending: true })
          .limit(1);
        if (admins && admins.length > 0) adminEmail = admins[0].email as string;
      }
    }

    // ---- email config gate (after authz so we never leak which kind
    //      would be sent before authorizing the caller) ----
    if (!resendKey || !resendFrom) {
      console.warn('[shift-alert-email] Resend not configured', {
        kind, manager: manager.email, admin: adminEmail,
        missing: [!resendKey ? 'RESEND_API_KEY' : null, !resendFrom ? 'RESEND_FROM_EMAIL' : null].filter(Boolean),
      });
      res.status(200).json({
        ok: false,
        error: 'email not configured',
        missing: [!resendKey ? 'RESEND_API_KEY' : null, !resendFrom ? 'RESEND_FROM_EMAIL' : null].filter(Boolean),
        would_send: kind === 'lock'
          ? { to: [manager.email, adminEmail].filter(Boolean) }
          : { to: [manager.email] },
      });
      return;
    }

    // ---- compose + send ----
    const sent: Array<{ to: string; id?: string; error?: string }> = [];

    if (kind === 'complete') {
      const subject = 'Shift complete for today';
      const text =
        `Hi ${managerName},\n\n` +
        `That's your 8 hours — your shift is complete for today. Great work.\n\n` +
        `Your account is now locked for the rest of the day. ` +
        `Tomorrow you'll see the Start Shift button again.\n\n` +
        `— EIA Projects (automated)`;
      const r = await sendResend({ apiKey: resendKey, from: resendFrom, to: manager.email, subject, text });
      sent.push({ to: manager.email, id: r.id, error: r.error });
    } else if (kind === 'bio_total_warn') {
      // Admin-only notification: manager's cumulative bio time crossed
      // the warn threshold (default ~1h). The manager already sees an
      // inline warning in BreakControls.
      if (!adminEmail) {
        res.status(200).json({ ok: false, error: 'no admin recipient configured', recipients: [] });
        return;
      }
      const subject = `[admin] Heavy bio-break usage: ${managerName}`;
      const text =
        `Heads up — manager "${managerName}" (${manager.email}) has accumulated ` +
        `more than the configured warn threshold of bio-break time today.\n\n` +
        `Open /admin → Shift Control to review their session and bio counters.\n\n` +
        `— EIA Projects (automated)`;
      const r = await sendResend({ apiKey: resendKey, from: resendFrom, to: adminEmail, subject, text });
      sent.push({ to: adminEmail, id: r.id, error: r.error });
    } else if (kind === 'break_overstay_lock') {
      // Step 4c — calm no-blame email to manager + admin when the
      // shift-break overstay lock fires. Sent once per lock (the
      // client gates this call on shift_mark_overstay_lock_emailed
      // returning emailed_now=true, which atomically transitions
      // overstay_lock_email_sent_at NULL → now() exactly once per
      // lock instance).
      const subject = 'Shift break exceeded — screen locked';
      const managerText =
        `Hi ${managerName},\n\n` +
        `Your break ran past the allowed time, so your screen has been locked. ` +
        `Please contact your admin to unlock and resume your shift.\n\n` +
        `— EIA Projects (automated)`;
      const r1 = await sendResend({ apiKey: resendKey, from: resendFrom, to: manager.email, subject, text: managerText });
      sent.push({ to: manager.email, id: r1.id, error: r1.error });
      if (adminEmail && adminEmail.toLowerCase() !== manager.email.toLowerCase()) {
        const adminText =
          `${managerName} exceeded their shift break time and their screen is now locked. ` +
          `You can unlock them from the Shift Control panel.\n\n` +
          `— EIA Projects (automated)`;
        const r2 = await sendResend({
          apiKey: resendKey, from: resendFrom, to: adminEmail,
          subject: `[admin] ${managerName} — shift break exceeded`,
          text: adminText,
        });
        sent.push({ to: adminEmail, id: r2.id, error: r2.error });
      }
    } else if (kind === '85') {
      const subject = 'Check-in coming up';
      const text =
        `Hi ${managerName},\n\n` +
        `Your check-in lock is approaching. Please save your place — ` +
        `the next mode-based lock will trigger shortly.\n\n` +
        `If your account locks, call your sir to inform him and have it unlocked.\n\n` +
        `— EIA Projects (automated)`;
      const r = await sendResend({ apiKey: resendKey, from: resendFrom, to: manager.email, subject, text });
      sent.push({ to: manager.email, id: r.id, error: r.error });
    } else {
      const subject = 'Your account is locked — call your sir to unlock';
      const textBase =
        `Hi ${managerName},\n\n` +
        `Your shift account has been locked at a check-in checkpoint. ` +
        `Please call your sir to inform him so he can unlock your account.\n\n` +
        `Mode: ${sess.mode}.  Period index: ${sess.current_period_index}.\n\n` +
        `— EIA Projects (automated)`;
      const r1 = await sendResend({ apiKey: resendKey, from: resendFrom, to: manager.email, subject, text: textBase });
      sent.push({ to: manager.email, id: r1.id, error: r1.error });
      if (adminEmail && adminEmail.toLowerCase() !== manager.email.toLowerCase()) {
        const adminText =
          `Manager "${managerName}" (${manager.email}) has been locked at a shift checkpoint.\n\n` +
          `Mode: ${sess.mode}.  Period index: ${sess.current_period_index}.\n\n` +
          `Unlock from /admin -> Locked Shifts.\n\n` +
          `— EIA Projects (automated)`;
        const r2 = await sendResend({
          apiKey: resendKey, from: resendFrom, to: adminEmail,
          subject: `[admin] ${managerName} is locked`, text: adminText,
        });
        sent.push({ to: adminEmail, id: r2.id, error: r2.error });
      }
    }

    const anyFailed = sent.some((s) => s.error);
    res.status(200).json({
      ok: !anyFailed,
      recipients: sent.map((s) => s.to),
      results: sent,
    });
  } catch (e) {
    const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error('[shift-alert-email] handler threw:', e);
    res.status(500).json({ ok: false, error: message });
  }
}
