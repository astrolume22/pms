/**
 * P4.4 — Manager Break Controls.
 *
 * Floats top-right of the BoardContent area NEXT TO the countdown chip
 * (which keeps ticking during breaks — PAID, never paused). State driven
 * by the live `shift_tick` payload coming through props.
 *
 * Render rules:
 *   - status='active' →
 *       [Shift Break]  [Bio Break]
 *       (each replaced by a DISABLED "used today" / "limit reached" pill
 *        when that break is no longer available — 0067 redesign)
 *   - status='on_shift_break' | 'on_bio_break' →
 *       [End Break] · On <kind> break — MM:SS  (shift counts DOWN,
 *       bio counts UP from 0:01 capped at 15:00, RED at 12:00)
 *   - status='locked' or other → nothing (the locked overlay covers it).
 *
 * Auto-end: when on_bio_break and current_break_elapsed_seconds reaches
 * bio_break_max_seconds_each (default 900), the component fires
 * shift_end_break automatically and shows a toast — the server will
 * record exceeded_cap=true for the audit trail.
 *
 * 0067 behaviour summary:
 *   • Shift break = ONCE PER DAY (server tracks shift_break_count_today;
 *     tick.shift_break_used_today flips the button → disabled pill).
 *   • Bio break = HARD LIMIT (server cap = config.bio_break_max_per_day,
 *     no admin grants; tick.bio_limit_reached flips the button →
 *     disabled pill).
 *   • Admin "Request bio break" flow REMOVED. No more requested state,
 *     handleRequest, useBioBreakRequestCreate.
 */
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Coffee, Square, User } from 'lucide-react';
import {
  useShiftTakeShiftBreak,
  useShiftTakeBioBreak,
  useShiftEndBreak,
  type ShiftTickPayload,
} from '@/hooks/shift';
import { safeGetSession } from '@/lib/safeAuth';
import { notifyImportant } from '@/lib/notify';

// 0067 — local extension for the new fields shift_tick now returns.
// We don't edit src/hooks/shift.ts (out of scope), so we widen the
// payload here via intersection at the read site.
type BreakTickExt = {
  shift_break_used_today?: boolean;
  shift_break_count_today?: number;
};

interface BreakControlsProps {
  sessionId: string;
  tick: ShiftTickPayload | undefined;
}

function formatMS(s: number): string {
  const v = Math.max(0, Math.floor(s));
  const m = Math.floor(v / 60);
  const sec = v % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// Fire-and-forget bio-total warn email to admin. Re-uses P4.3b endpoint.
async function postBioTotalWarn(sessionId: string): Promise<void> {
  try {
    const { data: { session }, timedOut } = await safeGetSession('shift-bio-total-warn');
    if (timedOut) return;
    const token = session?.access_token;
    if (!token) return;
    await fetch('/api/shift-alert-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ session_id: sessionId, kind: 'bio_total_warn' }),
      keepalive: true,
    });
  } catch (e) {
    console.warn('[shift] bio_total_warn email failed:', e);
  }
}

export function BreakControls({ sessionId, tick }: BreakControlsProps) {
  const takeShift = useShiftTakeShiftBreak();
  const takeBio   = useShiftTakeBioBreak();
  const endBreak  = useShiftEndBreak();

  // Local 1/sec interpolation for the "On {kind} break · MM:SS" display.
  // Mirrors ShiftCountdownChip but COUNTS UP. On every shift_tick poll
  // (10s) we snap to the server value via lastBreakSnapRef so refresh /
  // refocus / clock-change cannot fudge the displayed value; between
  // polls we increment locally so the timer feels live.
  //
  // CRITICAL: the auto-end-at-15-min effect + the bio-total warn email
  // BELOW must keep reading tick.current_break_elapsed_seconds /
  // tick.bio_break_total_seconds_today directly — those are SERVER-
  // AUTHORITATIVE decisions, not display-only.
  const [breakElapsed, setBreakElapsed] = useState<number>(0);
  const lastBreakSnapRef = useRef<number | null>(null);
  useEffect(() => {
    if (!tick) return;
    if (lastBreakSnapRef.current !== tick.current_break_elapsed_seconds) {
      lastBreakSnapRef.current = tick.current_break_elapsed_seconds;
      setBreakElapsed(tick.current_break_elapsed_seconds);
    }
  }, [tick]);
  const isOnBreakLocal = tick?.status === 'on_shift_break' || tick?.status === 'on_bio_break';
  useEffect(() => {
    if (!isOnBreakLocal) return;
    const id = setInterval(() => setBreakElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [isOnBreakLocal]);

  // Email-warn debouncer: once per shift, when total bio time hits warn.
  const warnEmailFiredRef = useRef(false);
  useEffect(() => {
    if (!tick) return;
    const warnTotal = tick.bio_break_warn_total_seconds ?? 0;
    if (warnTotal > 0
        && tick.bio_break_total_seconds_today >= warnTotal
        && !warnEmailFiredRef.current) {
      warnEmailFiredRef.current = true;
      void postBioTotalWarn(sessionId);
    }
  }, [tick, sessionId]);

  // Bio auto-end at 15 min.
  const autoEndFiredRef = useRef<string | null>(null);  // last break_started_at we acted on
  useEffect(() => {
    if (!tick || tick.status !== 'on_bio_break') return;
    const maxEach = tick.bio_break_max_seconds_each ?? 900;
    if (tick.current_break_elapsed_seconds >= maxEach
        && tick.current_break_started_at
        && autoEndFiredRef.current !== tick.current_break_started_at) {
      autoEndFiredRef.current = tick.current_break_started_at;
      void (async () => {
        try {
          await endBreak.mutateAsync(sessionId);
          toast.message('Bio break auto-ended at 15 minutes.');
        } catch (e) {
          console.warn('[shift] auto-end failed:', e);
        }
      })();
    }
  }, [tick, sessionId, endBreak]);

  // Bio "3 minutes left" warning — fires exactly ONCE per bio break,
  // de-duped by current_break_started_at (server resets it on every
  // new break). Triggers when the interpolated elapsed crosses 12:00
  // (720s), which is also when the timer text flips to red below.
  // notifyImportant surfaces the centered <WarningModal/> + bell chime.
  const bioWarn12FiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!tick || tick.status !== 'on_bio_break') return;
    if (!tick.current_break_started_at) return;
    if (breakElapsed < 720) return;
    if (bioWarn12FiredRef.current === tick.current_break_started_at) return;
    bioWarn12FiredRef.current = tick.current_break_started_at;
    notifyImportant({
      title: 'Bio break — 3 minutes left',
      body: 'You are approaching the 15-minute limit. Please wrap up.',
    });
  }, [tick, breakElapsed]);

  // Shift "5 minutes left" warning — same once-per-break, separate ref.
  // Fires when the interpolated countdown drops below 5:00 remaining
  // (i.e. breakElapsed >= shiftBreakAllowance - 300).
  const SHIFT_ALLOWANCE_FOR_WARN = 1800;
  const shiftWarn5FiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!tick || tick.status !== 'on_shift_break') return;
    if (!tick.current_break_started_at) return;
    if (breakElapsed < SHIFT_ALLOWANCE_FOR_WARN - 300) return;
    if (shiftWarn5FiredRef.current === tick.current_break_started_at) return;
    shiftWarn5FiredRef.current = tick.current_break_started_at;
    notifyImportant({
      title: 'Shift break — 5 minutes left',
      body: 'Your shift break is almost over. Please return soon.',
    });
  }, [tick, breakElapsed]);

  if (!tick) return null;

  // While locked / completed / not_started, this component renders nothing —
  // ShiftDriver decides the surface (gate, locked overlay).
  if (tick.status === 'not_started' || tick.status === 'locked' || tick.status === 'completed') {
    return null;
  }

  const onShiftBreak = tick.status === 'on_shift_break';
  const onBioBreak   = tick.status === 'on_bio_break';
  const onBreak = onShiftBreak || onBioBreak;

  // 0067 — read the two new tick fields. The local extension narrows
  // these to (boolean | undefined) so we tolerate an old payload during
  // a cache miss / cold boot.
  const tickExt = tick as ShiftTickPayload & BreakTickExt;
  const shiftBreakUsedToday = !!tickExt.shift_break_used_today;

  // ===================================================================
  // Per-kind break timer direction (display-only — server values still
  // drive auto-end + audit).
  //
  //   SHIFT break → COUNTS DOWN from the manager's shift_break_seconds
  //     allowance to 0:00. shift_tick does NOT currently surface
  //     shift_break_seconds in its payload, so we fall back to 1800s
  //     (30 min). When shift_tick is extended to expose this field,
  //     swap the constant for the value off `tick`.
  //
  //   BIO break   → COUNTS UP from 0:01 (we floor the display to 1s so
  //     the chip never reads "0:00" at the very start of the break),
  //     capped at bio_break_max_seconds_each (default 900 / 15:00) so
  //     the displayed value never overshoots the cap. The server-side
  //     auto-end-at-15-min effect (autoEndFiredRef above) still ends
  //     the actual break, reading tick.current_break_elapsed_seconds.
  // ===================================================================
  const SHIFT_BREAK_FALLBACK_SECS = 1800;
  const shiftBreakAllowance = SHIFT_BREAK_FALLBACK_SECS;
  const bioCapSecs = tick.bio_break_max_seconds_each ?? 900;
  const displayedBreakSecs = onShiftBreak
    ? Math.max(0, shiftBreakAllowance - breakElapsed)
    : Math.min(bioCapSecs, Math.max(1, breakElapsed));
  // Red at the 12:00 (720s) crossing for bio only.
  const bioRedWarn = onBioBreak && breakElapsed >= 720;

  // 0067 — hard cap (admin grants no longer add to the max). effMax
  // matches the server's v_eff_max in shift_tick.
  const bioCount = tick.bio_break_count_today;
  const effMax   = tick.bio_break_max_per_day ?? 7;
  const bioWarnCount = tick.bio_break_warn_count ?? 6;
  const bioTotalToday = tick.bio_break_total_seconds_today;
  const bioWarnTotal  = tick.bio_break_warn_total_seconds ?? 3600;
  const bioLimitReached = !!tick.bio_limit_reached;
  const showCountWarn = bioCount >= bioWarnCount && !bioLimitReached;
  const showTotalWarn = bioWarnTotal > 0 && bioTotalToday >= bioWarnTotal;

  const handleShiftBreak = async () => {
    try {
      const r = (await takeShift.mutateAsync(sessionId)) as { blocked?: boolean };
      // 0067 — server returns blocked:true if shift break already used.
      // shouldn't happen because the button is disabled in that case,
      // but defensive in case the poll lagged.
      if (r?.blocked === true) {
        toast.error("You've already taken your shift break today.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start shift break');
    }
  };
  const handleBioBreak = async () => {
    try {
      const r = (await takeBio.mutateAsync(sessionId)) as { limit_reached?: boolean };
      // 0067 — hard limit, no admin request escape hatch.
      if (r?.limit_reached === true) {
        toast.error('Bio break limit reached today.');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start bio break');
    }
  };
  const handleEnd = async () => {
    try { await endBreak.mutateAsync(sessionId); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not end break'); }
  };

  // Reusable disabled-pill style for the "used today" / "limit reached"
  // states — muted, non-interactive, visually distinct from active buttons.
  const disabledPillCls =
    'inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] font-medium ' +
    'text-text-secondary bg-slate-700/40 border border-border-light/60 cursor-not-allowed select-none';

  return (
    <div
      className="absolute top-4 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-1.5 pointer-events-none"
    >
      <div className="inline-flex items-center gap-2 pointer-events-auto">
        {onBreak ? (
          <>
            <span
              className={
                'inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] font-medium ' +
                (bioRedWarn
                  ? 'text-rose-400 bg-rose-950/40 border border-rose-700/50'
                  : 'text-amber-100 bg-amber-900/40 border border-amber-700/40')
              }
            >
              {onBioBreak ? <User className="h-3.5 w-3.5" /> : <Coffee className="h-3.5 w-3.5" />}
              On {onBioBreak ? 'bio' : 'shift'} break · {formatMS(displayedBreakSecs)}
            </span>
            <button
              type="button"
              onClick={() => void handleEnd()}
              disabled={endBreak.isPending}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] font-semibold bg-rose-900/40 text-rose-100 hover:brightness-110 disabled:opacity-60 border border-rose-700/40"
            >
              <Square className="h-3.5 w-3.5" />
              End break
            </button>
          </>
        ) : (
          <>
            {/*
              0067 — shift break is once per day. When the server reports
              shift_break_used_today, render a disabled pill INSTEAD of
              the active button. No request/approval path.
            */}
            {shiftBreakUsedToday ? (
              <span className={disabledPillCls} title="You have used your one shift break for today.">
                <Coffee className="h-3.5 w-3.5" />
                Shift break used today
              </span>
            ) : (
              <button
                type="button"
                onClick={() => void handleShiftBreak()}
                disabled={takeShift.isPending}
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] font-semibold text-sky-100 bg-sky-900/40 hover:brightness-110 disabled:opacity-60 border border-sky-700/40"
              >
                <Coffee className="h-3.5 w-3.5" />
                Shift break
              </button>
            )}

            {/*
              0067 — bio break is a hard stop. When the server reports
              bio_limit_reached, render a disabled pill INSTEAD of the
              old "Request bio break" button. The admin request flow is
              completely removed.
            */}
            {bioLimitReached ? (
              <span className={disabledPillCls} title="You have reached today's bio-break limit.">
                <User className="h-3.5 w-3.5" />
                Bio break limit reached today
              </span>
            ) : (
              <button
                type="button"
                onClick={() => void handleBioBreak()}
                disabled={takeBio.isPending}
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] font-semibold text-emerald-100 bg-emerald-900/40 hover:brightness-110 disabled:opacity-60 border border-emerald-700/40"
              >
                <User className="h-3.5 w-3.5" />
                Bio break
              </button>
            )}
          </>
        )}
      </div>

      {/*
        Bio count is ALWAYS visible when the manager is working (active +
        not on break). Muted/neutral until the warn threshold, amber from
        warn-count onwards (and on limitReached). Status check up top
        already filters out locked / completed / not_started, so this
        only renders during 'active'.
      */}
      {!onBreak && (
        <div className="pointer-events-auto inline-flex flex-col items-center gap-0.5 text-center">
          <span
            className={
              'text-[11px] px-2 py-0.5 rounded-full ' +
              ((showCountWarn || bioLimitReached)
                ? 'text-amber-200 bg-amber-900/30'
                : 'text-text-secondary bg-slate-700/30')
            }
          >
            You&apos;ve used {bioCount} of {effMax} bio breaks today.
          </span>
          {showTotalWarn && (
            <span className="text-[11px] text-amber-200 bg-amber-900/30 px-2 py-0.5 rounded-full">
              Over an hour of bio breaks today — admin notified.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
