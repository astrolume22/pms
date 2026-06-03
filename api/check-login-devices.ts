/**
 * /api/check-login-devices  —  PMS new-device / new-location login alert.
 *
 * Hourly Vercel Cron (vercel.json "crons"). For every successful PMS login
 * (Supabase Auth) by ANY account EXCEPT teamblue, if the device OR
 * location is new/unrecognized for that account, it emails the company
 * security mailbox. Routine logins from a known device+location are silent.
 *
 * Flow:
 *   1. recent_logins_except_teamblue() (SECURITY DEFINER, read-only on
 *      auth.*; migration 0054) returns each non-teamblue user's
 *      last_sign_in_at + IP + user-agent.
 *   2. Build device_fingerprint (browser + OS from UA) and resolve
 *      IP -> "city, country" (ipapi.co; graceful null).
 *   3. Look up known_logins for (account_email, device_fingerprint, location):
 *        • MATCH  -> recognized; bump last_seen; send NOTHING.
 *        • NO MATCH-> new device OR location; record it; email; dedupe
 *                     via login_alert_log so one event = one email.
 *
 * Hard guarantees:
 *   • Email goes to EXACTLY ONE hardcoded company-owned recipient
 *     (ALERT_RECIPIENT). Never cc/bcc, never a caller-supplied address.
 *   • One new-device/location event = one email (unique
 *     (user_email, login_at, device_fingerprint) index).
 *   • teamblue is excluded in the RPC by id AND email — fully separate
 *     from the teamblue rotation reminder, which is left untouched.
 *
 * Reuses the EXISTING Resend setup (RESEND_API_KEY / RESEND_FROM_EMAIL)
 * and resolveLocation / formatManila from the teamblue endpoint
 * (imported, not modified).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { resolveLocation, formatManila } from './check-teamblue-login.js';

export const config = { maxDuration: 60 };

// The ONE and ONLY recipient — the company-owned security mailbox
// (Sondryn is the parent company of EIA). Hardcoded on purpose; do not
// parameterize, no cc/bcc.
const ALERT_RECIPIENT = 'info@sondryn.com';

export interface LoginRow {
  user_id: string;
  email: string | null;
  role: string | null;
  login_at: string | null;
  login_ip: string | null;
  user_agent: string | null;
}

export interface KnownRow { id: string; last_seen: string }
export interface AlertRow { id: string; alerted_at: string | null }

// ---------------------------------------------------------------------
// fingerprintDevice() — PURE. Derive a stable "Browser on OS" label from
// a user-agent string. Returns 'unknown' when the UA is absent or
// unrecognized (this project's Supabase audit log often carries no UA).
// ---------------------------------------------------------------------
export function fingerprintDevice(ua: string | null): string {
  if (!ua || !ua.trim()) return 'unknown';
  const browser =
    /Edg\//.test(ua) ? 'Edge' :
    /OPR\/|Opera/.test(ua) ? 'Opera' :
    /Chrome\//.test(ua) ? 'Chrome' :
    /Firefox\//.test(ua) ? 'Firefox' :
    /Safari\//.test(ua) ? 'Safari' :
    'Browser';
  const os =
    /Windows NT/.test(ua) ? 'Windows' :
    /iPhone|iPad|iOS/.test(ua) ? 'iOS' :
    /Mac OS X|Macintosh/.test(ua) ? 'macOS' :
    /Android/.test(ua) ? 'Android' :
    /Linux/.test(ua) ? 'Linux' :
    'unknown OS';
  return `${browser} on ${os}`;
}

// ---------------------------------------------------------------------
// classify() — PURE. Known row present => recognized; else new.
// ---------------------------------------------------------------------
export function classify(known: KnownRow | null): 'known' | 'new' {
  return known ? 'known' : 'new';
}

// ---------------------------------------------------------------------
// alertDecision() — PURE. Dedupe for the alert ledger.
// ---------------------------------------------------------------------
export function alertDecision(existing: AlertRow | null): 'send' | 'retry' | 'skip' {
  if (!existing) return 'send';
  if (!existing.alerted_at) return 'retry';
  return 'skip';
}

// ---------------------------------------------------------------------
// buildDeviceAlertEmail() — PURE plain-text builder. `to` is ALWAYS the
// single hardcoded company recipient; it cannot be overridden by caller data.
// ---------------------------------------------------------------------
export function buildDeviceAlertEmail(opts: {
  email: string;
  role: string | null;
  login_at: string;
  login_ip: string | null;
  login_location: string | null;
  device: string | null;
}): { to: string; subject: string; text: string } {
  const text =
`New device or location login detected on PMS.
Account: ${opts.email} (${opts.role ?? 'unknown'})
Time: ${formatManila(opts.login_at)}
Location: ${opts.login_location ?? 'unknown'}
IP: ${opts.login_ip ?? 'unknown'}
Device: ${opts.device ?? 'unknown'}
If this login is not from an expected device or location, review and rotate that account's access.`;

  return { to: ALERT_RECIPIENT, subject: `PMS new-device/location login: ${opts.email}`, text };
}

async function sendEmail(
  resendKey: string,
  resendFrom: string,
  email: { subject: string; text: string },
): Promise<boolean> {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: resendFrom,
      to: ALERT_RECIPIENT,   // hardcoded — never caller data
      subject: email.subject,
      text: email.text,
    }),
  });
  return resp.ok;
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
      res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured' }); return;
    }
    if (!resendKey || !resendFrom) {
      res.status(500).json({ error: 'RESEND_API_KEY / RESEND_FROM_EMAIL not configured' }); return;
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

    const { data: rows, error: rpcErr } = await sb.rpc('recent_logins_except_teamblue');
    if (rpcErr) { res.status(500).json({ error: `recent_logins_except_teamblue failed: ${rpcErr.message}` }); return; }
    const logins = (rows ?? []) as LoginRow[];

    const summary = { checked: logins.length, alerted: 0, recognized: 0, retried: 0, skipped: 0, errors: 0 };

    for (const row of logins) {
      if (!row.login_at || !row.email) { summary.skipped++; continue; }

      const device = fingerprintDevice(row.user_agent);
      const location = (await resolveLocation(row.login_ip)) ?? 'unknown';

      // --- new vs known? ---
      const { data: knownRows } = await sb
        .from('known_logins')
        .select('id, last_seen')
        .eq('account_email', row.email)
        .eq('device_fingerprint', device)
        .eq('location', location)
        .limit(1);
      const known = (knownRows?.[0] as KnownRow) ?? null;

      if (classify(known) === 'known') {
        // recognized device+location -> bump last_seen, no email
        await sb.from('known_logins')
          .update({ last_seen: new Date().toISOString() } as never)
          .eq('id', known!.id);   // single-row write by id
        summary.recognized++;
        continue;
      }

      // --- new device OR location: dedupe the alert ---
      const { data: alertRows } = await sb
        .from('login_alert_log')
        .select('id, alerted_at')
        .eq('user_email', row.email)
        .eq('login_at', row.login_at)
        .eq('device_fingerprint', device)
        .limit(1);
      const decision = alertDecision((alertRows?.[0] as AlertRow) ?? null);

      // Record the device as known so future logins from it are silent.
      // (UNIQUE index makes a concurrent duplicate a harmless 23505.)
      await sb.from('known_logins')
        .insert({ account_email: row.email, device_fingerprint: device, location } as never);

      if (decision === 'skip') { summary.skipped++; continue; }

      const email = buildDeviceAlertEmail({
        email: row.email, role: row.role, login_at: row.login_at,
        login_ip: row.login_ip, login_location: location === 'unknown' ? null : location, device,
      });

      if (decision === 'send') {
        // Claim the alert first so an overlapping tick can't double-send.
        const { data: inserted, error: insErr } = await sb
          .from('login_alert_log')
          .insert({
            user_email: row.email, role: row.role, login_at: row.login_at,
            login_ip: row.login_ip, login_location: location, device_fingerprint: device,
          } as never)
          .select('id')
          .single();
        if (insErr) {
          if ((insErr as { code?: string }).code === '23505') { summary.skipped++; continue; } // race
          summary.errors++; continue;
        }
        const ok = await sendEmail(resendKey, resendFrom, email);
        if (ok) {
          await sb.from('login_alert_log')
            .update({ alerted_at: new Date().toISOString() } as never)
            .eq('id', (inserted as { id: string }).id);   // single-row write by id
          summary.alerted++;
        } else { summary.errors++; }
      } else {
        // retry: ledger row exists, prior email never sent
        const ok = await sendEmail(resendKey, resendFrom, email);
        if (ok) {
          await sb.from('login_alert_log')
            .update({ alerted_at: new Date().toISOString() } as never)
            .eq('id', (alertRows![0] as AlertRow).id);   // single-row write by id
          summary.retried++;
        } else { summary.errors++; }
      }
    }

    // =================================================================
    // P4.8 — Shift system sweep (folded into this existing daily cron
    // to stay within the Vercel Hobby tier's 2-cron limit). Catches:
    //   • status='active'/'on_*_break' sessions whose work elapsed has
    //     reached required_seconds while the tab was closed → marks
    //     them 'completed' + emits shift_complete event.
    //   • prior-day orphaned non-completed sessions → closes them.
    // Service-role calls the RPC; RPC's auth check (auth.uid() IS NULL)
    // lets the cron through without an admin user.
    //
    // Best-effort emails to managers we just auto-completed. Failures
    // here MUST NOT fail the existing login-devices cron — wrap in try.
    // =================================================================
    const shiftSweep: { completed: number; orphan: number; emails: number; errors: number; skipped: number } =
      { completed: 0, orphan: 0, emails: 0, errors: 0, skipped: 0 };
    try {
      const { data: sweepResult, error: sweepErr } = await sb.rpc('shift_sweep_due_and_orphans');
      if (sweepErr) {
        shiftSweep.errors++;
        console.error('[shift sweep] RPC failed:', sweepErr.message);
      } else {
        const r = (sweepResult ?? {}) as {
          completed_today_count?: number;
          completed_today_user_ids?: string[];
          closed_orphan_count?: number;
        };
        shiftSweep.completed = r.completed_today_count ?? 0;
        shiftSweep.orphan    = r.closed_orphan_count ?? 0;
        const ids = (r.completed_today_user_ids ?? []) as string[];
        if (ids.length > 0) {
          // Email each newly-completed manager. Need today's session_id
          // for /api/shift-alert-email — look them up in one query.
          const todayUTC = new Date().toISOString().slice(0, 10);
          const { data: sessions } = await sb
            .from('shift_sessions')
            .select('id, user_id, mode, current_period_index')
            .eq('work_date', todayUTC)
            .eq('status', 'completed')
            .in('user_id', ids);
          for (const s of (sessions ?? []) as Array<{ id: string; user_id: string; mode: string; current_period_index: number }>) {
            // Look up manager email + name
            const { data: u } = await sb.from('users').select('email, full_name, username').eq('id', s.user_id).maybeSingle();
            if (!u?.email) { shiftSweep.skipped++; continue; }
            const name = (u as { email: string; full_name: string | null; username: string }).full_name
                       ?? (u as { username: string }).username;
            const subject = 'Shift complete for today';
            const text =
              `Hi ${name},\n\n` +
              `That's your 8 hours — your shift is complete for today. Great work.\n\n` +
              `Your account is now locked for the rest of the day. ` +
              `Tomorrow you'll see the Start Shift button again.\n\n` +
              `— EIA Projects (automated)`;
            const ok = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ from: resendFrom, to: (u as { email: string }).email, subject, text }),
            }).then((r) => r.ok).catch(() => false);
            if (ok) shiftSweep.emails++; else shiftSweep.errors++;
          }
        }
      }
    } catch (e) {
      shiftSweep.errors++;
      console.error('[shift sweep] threw:', e);
    }

    res.status(200).json({ status: 'ok', recipient: ALERT_RECIPIENT, ...summary, shift_sweep: shiftSweep });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message ?? 'unknown error' });
  }
}
