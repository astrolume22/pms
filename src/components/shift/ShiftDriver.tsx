/**
 * P4.3 — Manager-side shift orchestrator.
 *
 * One component that subscribes to today's session + the 10s tick poll
 * and renders the right overlay based on server state:
 *   - status='not_started' → <StartShiftGate />
 *   - status='locked'      → <ShiftLockedOverlay /> (no unlock button)
 *   - anything else        → <ShiftCountdownChip />
 *
 * Side effects (fired off the tick payload):
 *   - period_85_due true & not yet alerted this period
 *       → soft sonner toast + shift_mark_85_alerted RPC (idempotent
 *         server-side; we also debounce locally per period)
 *   - period_lock_due true OR status='locked' returned by tick
 *       → shift_self_period_lock RPC (idempotent server-side, no-op if
 *         already locked). The next tick returns status='locked' and
 *         the overlay mounts.
 *
 * Mounted by BoardContent only when the user is a manager. Admins and
 * super never reach this code path — no tick polling, no RPCs.
 */
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import {
  useTodayShiftSession,
  useMyAccountLock,
  useShiftTick,
  useShiftMark85Alerted,
  useShiftSelfPeriodLock,
  useShiftCompleteIfDue,
} from '@/hooks/shift';
import { safeGetSession } from '@/lib/safeAuth';
import { StartShiftGate } from './StartShiftGate';
import { ShiftCountdownChip } from './ShiftCountdownChip';
import { ShiftLockedOverlay } from './ShiftLockedOverlay';
import { ShiftCompletedOverlay } from './ShiftCompletedOverlay';
import { AccountLockedOverlay } from './AccountLockedOverlay';
import { BreakControls } from './BreakControls';

// Fire-and-forget POST to the email-alert endpoint. Caller authenticates
// with the manager's Supabase access token (Bearer JWT) — no leakable
// shared secret. Failures are logged but never break the shift UI.
// `keepalive: true` lets the request survive even if the page navigates
// or the user closes the tab right after firing.
async function postShiftAlertEmail(sessionId: string, kind: '85' | 'lock' | 'complete' | 'bio_total_warn'): Promise<void> {
  try {
    const { data: { session }, timedOut } = await safeGetSession('shift-email');
    if (timedOut) {
      console.warn('[shift] getSession timed out; skipping email post');
      return;
    }
    const token = session?.access_token;
    if (!token) {
      console.warn('[shift] no access token; skipping email post');
      return;
    }
    const resp = await fetch('/api/shift-alert-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ session_id: sessionId, kind }),
      keepalive: true,
    });
    const body = (await resp.json().catch(() => ({} as Record<string, unknown>))) as Record<string, unknown>;
    if (!resp.ok || body.ok === false) {
      console.warn(`[shift] email post returned`, resp.status, body);
    } else {
      console.info(`[shift] email post ok kind=${kind}`, body);
    }
  } catch (e) {
    console.warn('[shift] email post failed:', e);
  }
}

export function ShiftDriver() {
  const { data: session } = useTodayShiftSession(true);
  // Account-level lock (0064). Polls every 30s on its own (see hook).
  // Server enforces the same flag in shift_start(); this hook is the UI
  // signal so a locked manager sees the overlay instead of the start
  // button. If the call errors out (cold network), we fall through —
  // shift_start will still refuse server-side.
  const { data: accountLock } = useMyAccountLock(true);
  const sessionId = session?.id;

  // Tick query stays disabled until we have a session id AND the gate
  // is no longer required — once started, it polls every 10s.
  const tickEnabled = !!sessionId && session.status !== 'not_started';
  const { data: tick } = useShiftTick(sessionId, tickEnabled);

  const mark85 = useShiftMark85Alerted();
  const selfLock = useShiftSelfPeriodLock();
  const completeIfDue = useShiftCompleteIfDue();

  // Debounce 85% alerts client-side per period — server is idempotent
  // but we don't want to spam the RPC every 10s while waiting for the
  // toast acknowledgement. Track the LAST period index we've handled.
  const alertedPeriodRef = useRef<number>(-1);
  useEffect(() => {
    if (!tick || !sessionId) return;
    if (tick.period_85_due && alertedPeriodRef.current < tick.current_period_index) {
      alertedPeriodRef.current = tick.current_period_index;
      toast('Heads up — your check-in lock is coming soon. Save your place.', {
        duration: 8_000,
      });
      // P4.3b: piggyback email on the RPC. Server-side mark RPC is
      // idempotent; we only send the email when the RPC confirms this
      // was a FRESH alert (already_alerted=false) — the same once-per-
      // period guard the spec calls out.
      void (async () => {
        try {
          const result = await mark85.mutateAsync(sessionId);
          if (result && result.already_alerted === false) {
            void postShiftAlertEmail(sessionId, '85');
          }
        } catch (e) {
          console.warn('[shift] mark85 failed:', e);
        }
      })();
    }
  }, [tick, sessionId, mark85]);

  // P4.5 — subtle "you started X min late today" toast, once per session.
  // Stays off the screen if late_start_flag is false or null. Strict
  // anti-nag: keyed on session id so it never re-fires for the same
  // session after a refresh.
  const lateNotifiedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!tick || !sessionId) return;
    if (tick.late_start_flag === true
        && typeof tick.late_start_minutes === 'number'
        && lateNotifiedRef.current !== sessionId) {
      lateNotifiedRef.current = sessionId;
      toast.message(`You started ${tick.late_start_minutes} minutes late today.`, { duration: 6_000 });
    }
  }, [tick, sessionId]);

  // P4.8 — instant 8h complete. When tick reports remaining_seconds==0
  // AND status is a working state, fire shift_complete_if_due once. The
  // RPC is idempotent; the lockedFiredRef-style debounce here is a
  // cheap belt-and-suspenders so we don't spam it every 10s.
  const completeFiredRef = useRef<string | null>(null);  // last session_id we fired for
  useEffect(() => {
    if (!tick || !sessionId) return;
    const isWorking = tick.status === 'active'
      || tick.status === 'on_shift_break' || tick.status === 'on_bio_break';
    if (isWorking && tick.remaining_seconds <= 0 && completeFiredRef.current !== sessionId) {
      completeFiredRef.current = sessionId;
      void (async () => {
        try {
          const r = await completeIfDue.mutateAsync(sessionId);
          if (r && r.completed === true && r.already_completed === false) {
            toast.success("Shift complete — that's your 8 hours. Great work.", { duration: 10_000 });
            void postShiftAlertEmail(sessionId, 'complete');
          }
        } catch (e) {
          console.warn('[shift] complete_if_due failed:', e);
        }
      })();
    }
    // Reset the fired guard when a NEW (different) session id appears
    // (lazy daily reset: tomorrow's row has a fresh uuid).
    if (sessionId && completeFiredRef.current && completeFiredRef.current !== sessionId
        && tick.status === 'not_started') {
      completeFiredRef.current = null;
    }
  }, [tick, sessionId, completeIfDue]);

  // Auto-fire the period lock when the server says it's due. The RPC
  // is idempotent so the multiple 10s ticks during the same lock-due
  // window each call it harmlessly. Once status flips to 'locked' the
  // condition turns off naturally.
  const lockedFiredRef = useRef<number>(-1);
  useEffect(() => {
    if (!tick || !sessionId) return;
    if (tick.period_lock_due && tick.status !== 'locked'
        && lockedFiredRef.current < tick.current_period_index) {
      lockedFiredRef.current = tick.current_period_index;
      // P4.3b: email piggybacks the FRESH lock only.
      void (async () => {
        try {
          const result = await selfLock.mutateAsync(sessionId);
          if (result && result.already_locked === false) {
            void postShiftAlertEmail(sessionId, 'lock');
          }
        } catch (e) {
          console.warn('[shift] self_period_lock failed:', e);
        }
      })();
    }
  }, [tick, sessionId, selfLock]);

  if (!session) return null;

  // Render rules: gate, locked, or chip.
  // Note: `session.status` is the cached row (may lag by one round-trip
  // after a mutation); `tick?.status` reflects the live server state.
  // Prefer tick when present.
  const liveStatus = tick?.status ?? session.status;

  // ACCOUNT lock check (0064). Comes BEFORE the not_started branch so a
  // locked manager never sees the Start Shift button. Falls through to
  // the regular branches when accountLock isn't yet loaded (cold mount)
  // — the server-side shift_start() guard refuses regardless if they
  // somehow click Start before the lock state lands.
  if (accountLock?.account_locked) {
    return <AccountLockedOverlay />;
  }
  if (liveStatus === 'not_started') {
    return <StartShiftGate />;
  }
  if (liveStatus === 'locked') {
    return <ShiftLockedOverlay />;
  }
  if (liveStatus === 'completed') {
    return <ShiftCompletedOverlay />;
  }
  // Active / break: countdown chip (which keeps ticking through
  // breaks) AND the break controls. React Query dedupes the
  // shift_tick query by key, so both components share the same poll.
  return (
    <>
      <ShiftCountdownChip sessionId={session.id} />
      <BreakControls sessionId={session.id} tick={tick} />
    </>
  );
}
