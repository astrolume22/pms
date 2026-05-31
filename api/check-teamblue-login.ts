/**
 * /api/check-teamblue-login  —  teamblue backup-login rotation reminder.
 *
 * Invoked by Vercel Cron (vercel.json "crons") every few minutes. It:
 *   1. Reads the teamblue auth user's last_sign_in_at + latest login IP
 *      via the teamblue_last_login() RPC (SECURITY DEFINER, read-only on
 *      auth.*; migration 0053).
 *   2. If that timestamp advanced past the newest row in
 *      public.teamblue_rotation_log → records a NEW login event
 *      (resolving IP -> city,country) and emails HR a reminder.
 *   3. Otherwise, if the newest event is still un-rotated and 72h have
 *      passed since the reminder → sends ONE chaser, then stops.
 *
 * Hard guarantees:
 *   • Email goes to EXACTLY ONE hardcoded recipient (HR_RECIPIENT).
 *     Never a candidate, never cc/bcc, never a caller-supplied address.
 *   • At most 2 emails per login event (1 reminder + 1 chaser).
 *   • Reuses the SAME Resend setup as /api/send-invite-email
 *     (RESEND_API_KEY / RESEND_FROM_EMAIL).
 *
 * Auth: cron calls carry the `x-vercel-cron` header (same model as
 * /api/ai-build). A Bearer-admin JWT is also accepted for manual runs.
 *
 * Touches NO auth logic, RLS, invite/reset flow, or existing cron.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 30 };

// The ONE and ONLY recipient. Hardcoded on purpose — do not parameterize.
const HR_RECIPIENT = 'talent.expertadvisor@outlook.com';

// 72 hours, in milliseconds.
const CHASER_AFTER_MS = 72 * 60 * 60 * 1000;

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------
export interface RotationRow {
  id: string;
  login_at: string;            // ISO
  login_ip: string | null;
  login_location: string | null;
  reminder_sent_at: string | null;
  chaser_sent_at: string | null;
  rotated: boolean;
}

export interface LastLogin {
  login_at: string | null;     // ISO from auth.users.last_sign_in_at
  login_ip: string | null;
}

export type Decision =
  | { action: 'no-login-data' }
  | { action: 'already-handled' }                 // nothing new + nothing due
  | { action: 'new-login' }                       // insert + send reminder
  | { action: 'retry-reminder'; rowId: string }   // prior reminder never sent
  | { action: 'send-chaser'; rowId: string }      // 72h elapsed, not rotated
  | { action: 'rotated' };                         // newest event already rotated

// ---------------------------------------------------------------------
// decide() — PURE decision function (no I/O). This is the testable core.
//
//   last   : current teamblue last-login peek
//   latest : newest row in teamblue_rotation_log (or null if none yet)
//   nowMs  : Date.now() at evaluation time
// ---------------------------------------------------------------------
export function decide(last: LastLogin, latest: RotationRow | null, nowMs: number): Decision {
  if (!last.login_at) return { action: 'no-login-data' };

  const loginMs = Date.parse(last.login_at);

  // A brand-new (advanced) login timestamp => new event.
  if (!latest || (Number.isFinite(loginMs) && loginMs > Date.parse(latest.login_at))) {
    return { action: 'new-login' };
  }

  // No new login. Work the newest existing event.
  if (latest.rotated) return { action: 'rotated' };

  // Prior reminder never actually sent (e.g. Resend failed) -> retry it.
  // This is NOT an extra email: the first attempt did not deliver.
  if (!latest.reminder_sent_at) {
    return { action: 'retry-reminder', rowId: latest.id };
  }

  // Reminder sent, not rotated, no chaser yet, and 72h elapsed -> chaser.
  if (!latest.chaser_sent_at && nowMs - Date.parse(latest.reminder_sent_at) >= CHASER_AFTER_MS) {
    return { action: 'send-chaser', rowId: latest.id };
  }

  return { action: 'already-handled' };
}

// ---------------------------------------------------------------------
// resolveLocation() — best-effort IP -> "City, Country". Free lookup
// (ipapi.co). Any failure (no IP, rate-limit, network) returns null and
// the email omits the city gracefully. `fetchImpl` is injectable so the
// proof harness can exercise it without real network.
// ---------------------------------------------------------------------
export async function resolveLocation(
  ip: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (!ip) return null;
  try {
    const resp = await fetchImpl(`https://ipapi.co/${encodeURIComponent(ip)}/json/`);
    if (!resp.ok) return null;
    const data = (await resp.json()) as { city?: string; country_name?: string; error?: boolean };
    if (!data || data.error) return null;
    const parts = [data.city, data.country_name].filter((s): s is string => !!s && s.trim() !== '');
    return parts.length ? parts.join(', ') : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// formatManila() — render an ISO timestamp in Manila local time.
// ---------------------------------------------------------------------
export function formatManila(iso: string): string {
  try {
    const s = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
    return `${s} (PHT)`;
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------
// buildEmail() — PURE plain-text email builder. `to` is ALWAYS the
// single hardcoded HR recipient; the value cannot be overridden.
// ---------------------------------------------------------------------
export function buildEmail(opts: {
  login_at: string;
  login_ip: string | null;
  login_location: string | null;
  isChaser: boolean;
}): { to: string; subject: string; text: string } {
  const when = formatManila(opts.login_at);
  const locationLine = opts.login_location
    ? `Location: ${opts.login_location}${opts.login_ip ? ` (IP ${opts.login_ip})` : ''}`
    : opts.login_ip
      ? `Location: unknown (IP ${opts.login_ip})`
      : `Location: unknown`;

  const text =
`The teamblue backup login was just used.
Login time: ${when}
${locationLine}

Within 72 hours, please complete these 3 steps:
1) Reset the teamblue password: https://projects.expertintuitiveadvisor.com/admin (Users → teamblue → Reset password)
2) Re-invite this candidate to their own account: https://projects.expertintuitiveadvisor.com/admin
3) Update Sylvia's password in her prompt: https://elevenlabs.io/app/agents/agents/agent_4501ksmjapkvf4gbqgwcfnjhjrgt?tab=agent&branchId=agtbrch_4601ksmjarbjexnv8raqmm1b02de

Once you reset the password, mark it rotated so reminders stop.`;

  const base = 'teamblue backup login was used — rotate within 72h';
  const subject = opts.isChaser ? `REMINDER: ${base}` : base;

  return { to: HR_RECIPIENT, subject, text };
}

// ---------------------------------------------------------------------
// sendEmail() — POST to Resend. ALWAYS to the single HR recipient.
// ---------------------------------------------------------------------
async function sendEmail(
  resendKey: string,
  resendFrom: string,
  email: { to: string; subject: string; text: string },
): Promise<{ ok: boolean; detail?: unknown }> {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: resendFrom,
      to: HR_RECIPIENT,        // hardcoded — never email.to from caller data
      subject: email.subject,
      text: email.text,
    }),
  });
  if (!resp.ok) return { ok: false, detail: await resp.json().catch(() => null) };
  return { ok: true, detail: await resp.json().catch(() => null) };
}

// ---------------------------------------------------------------------
// handler
// ---------------------------------------------------------------------
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  try {
    const resendKey   = process.env.RESEND_API_KEY;
    const resendFrom  = process.env.RESEND_FROM_EMAIL;
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
    const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured' });
      return;
    }
    if (!resendKey || !resendFrom) {
      res.status(500).json({ error: 'RESEND_API_KEY / RESEND_FROM_EMAIL not configured' });
      return;
    }

    const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // --- auth: Vercel cron header OR a valid Bearer JWT (manual run) ---
    const isCron = !!req.headers['x-vercel-cron'];
    if (!isCron) {
      const authHeader = req.headers.authorization ?? '';
      const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (!jwt) { res.status(401).json({ error: 'missing cron header or Bearer token' }); return; }
      const { data: userResp, error: userErr } = await sb.auth.getUser(jwt);
      if (userErr || !userResp?.user) { res.status(401).json({ error: 'invalid session' }); return; }
    }

    // --- 1. peek at teamblue's last login ---
    const { data: peek, error: peekErr } = await sb.rpc('teamblue_last_login');
    if (peekErr) { res.status(500).json({ error: `teamblue_last_login failed: ${peekErr.message}` }); return; }
    const last: LastLogin = Array.isArray(peek) && peek[0]
      ? { login_at: peek[0].login_at ?? null, login_ip: peek[0].login_ip ?? null }
      : { login_at: null, login_ip: null };

    // --- 2. newest existing event ---
    const { data: latestRows, error: latestErr } = await sb
      .from('teamblue_rotation_log')
      .select('*')
      .order('login_at', { ascending: false })
      .limit(1);
    if (latestErr) { res.status(500).json({ error: `read log failed: ${latestErr.message}` }); return; }
    const latest: RotationRow | null = (latestRows?.[0] as RotationRow) ?? null;

    const decision = decide(last, latest, Date.now());

    switch (decision.action) {
      case 'new-login': {
        const login_at = last.login_at!;
        const login_location = await resolveLocation(last.login_ip);
        // Insert the event first (claims it so we don't double-handle).
        const { data: inserted, error: insErr } = await sb
          .from('teamblue_rotation_log')
          .insert({ login_at, login_ip: last.login_ip, login_location, rotated: false } as never)
          .select('*')
          .single();
        if (insErr) {
          // Unique-violation => another tick already claimed it. Fine.
          if ((insErr as { code?: string }).code === '23505') {
            res.status(200).json({ status: 'race-skipped' }); return;
          }
          res.status(500).json({ error: `insert failed: ${insErr.message}` }); return;
        }
        const row = inserted as RotationRow;
        const email = buildEmail({ login_at, login_ip: last.login_ip, login_location, isChaser: false });
        const sent = await sendEmail(resendKey, resendFrom, email);
        if (sent.ok) {
          await sb.from('teamblue_rotation_log')
            .update({ reminder_sent_at: new Date().toISOString() } as never)
            .eq('id', row.id);   // single-row write by id
        }
        res.status(200).json({ status: 'reminder-sent', emailed: sent.ok, to: HR_RECIPIENT, login_at, login_location });
        return;
      }

      case 'retry-reminder': {
        const email = buildEmail({
          login_at: latest!.login_at, login_ip: latest!.login_ip,
          login_location: latest!.login_location, isChaser: false,
        });
        const sent = await sendEmail(resendKey, resendFrom, email);
        if (sent.ok) {
          await sb.from('teamblue_rotation_log')
            .update({ reminder_sent_at: new Date().toISOString() } as never)
            .eq('id', decision.rowId);
        }
        res.status(200).json({ status: 'reminder-retried', emailed: sent.ok, to: HR_RECIPIENT });
        return;
      }

      case 'send-chaser': {
        const email = buildEmail({
          login_at: latest!.login_at, login_ip: latest!.login_ip,
          login_location: latest!.login_location, isChaser: true,
        });
        const sent = await sendEmail(resendKey, resendFrom, email);
        if (sent.ok) {
          await sb.from('teamblue_rotation_log')
            .update({ chaser_sent_at: new Date().toISOString() } as never)
            .eq('id', decision.rowId);   // single-row write by id
        }
        res.status(200).json({ status: 'chaser-sent', emailed: sent.ok, to: HR_RECIPIENT });
        return;
      }

      default:
        res.status(200).json({ status: decision.action });
        return;
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message ?? 'unknown error' });
  }
}
