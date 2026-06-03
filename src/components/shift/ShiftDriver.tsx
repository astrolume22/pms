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
  useShiftTick,
  useShiftMark85Alerted,
  useShiftSelfPeriodLock,
} from '@/hooks/shift';
import { StartShiftGate } from './StartShiftGate';
import { ShiftCountdownChip } from './ShiftCountdownChip';
import { ShiftLockedOverlay } from './ShiftLockedOverlay';

export function ShiftDriver() {
  const { data: session } = useTodayShiftSession(true);
  const sessionId = session?.id;

  // Tick query stays disabled until we have a session id AND the gate
  // is no longer required — once started, it polls every 10s.
  const tickEnabled = !!sessionId && session.status !== 'not_started';
  const { data: tick } = useShiftTick(sessionId, tickEnabled);

  const mark85 = useShiftMark85Alerted();
  const selfLock = useShiftSelfPeriodLock();

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
      mark85.mutate(sessionId);
    }
  }, [tick, sessionId, mark85]);

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
      selfLock.mutate(sessionId);
    }
    // Reset the lock-fired guard whenever the period index advances
    // (admin unlocked + we're past the boundary again).
    if (tick.current_period_index > lockedFiredRef.current + 0) {
      // no-op — already tracked above when we fire; this branch reserved
      // for future "skip-fired-period" logic if we ever add manual lock.
    }
  }, [tick, sessionId, selfLock]);

  if (!session) return null;

  // Render rules: gate, locked, or chip.
  // Note: `session.status` is the cached row (may lag by one round-trip
  // after a mutation); `tick?.status` reflects the live server state.
  // Prefer tick when present.
  const liveStatus = tick?.status ?? session.status;

  if (liveStatus === 'not_started') {
    return <StartShiftGate />;
  }
  if (liveStatus === 'locked') {
    return <ShiftLockedOverlay />;
  }
  return <ShiftCountdownChip sessionId={session.id} />;
}
