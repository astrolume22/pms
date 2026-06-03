/**
 * P4.4 — Manager Break Controls.
 *
 * Floats top-right of the BoardContent area NEXT TO the countdown chip
 * (which keeps ticking during breaks — PAID, never paused). State driven
 * by the live `shift_tick` payload coming through props.
 *
 * Render rules:
 *   - status='active' →
 *       [Shift Break]  [Bio Break / Request Bio Break]
 *       + warn line under Bio when count >= warn_count
 *       + warn line under Bio when total >= warn_total_seconds (also
 *         emails admin via the P4.3b /api/shift-alert-email endpoint
 *         with kind='bio_total_warn', once per shift).
 *   - status='on_shift_break' | 'on_bio_break' →
 *       [End Break] · On <kind> break — MM:SS
 *   - status='locked' or other → nothing (the locked overlay covers it).
 *
 * Auto-end: when on_bio_break and current_break_elapsed_seconds reaches
 * bio_break_max_seconds_each (default 900), the component fires
 * shift_end_break automatically and shows a toast — the server will
 * record exceeded_cap=true for the audit trail.
 */
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Coffee, Send, Square, User } from 'lucide-react';
import {
  useShiftTakeShiftBreak,
  useShiftTakeBioBreak,
  useShiftEndBreak,
  useBioBreakRequestCreate,
  type ShiftTickPayload,
} from '@/hooks/shift';
import { supabase } from '@/lib/supabase';

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
    const { data: { session } } = await supabase.auth.getSession();
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
  const createReq = useBioBreakRequestCreate();
  const [requested, setRequested] = useState(false);

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

  // Reset request flag whenever counts change (admin granted +1 → bumps)
  useEffect(() => { setRequested(false); }, [tick?.bio_break_admin_grants_today]);

  if (!tick) return null;

  // While locked / completed / not_started, this component renders nothing —
  // ShiftDriver decides the surface (gate, locked overlay).
  if (tick.status === 'not_started' || tick.status === 'locked' || tick.status === 'completed') {
    return null;
  }

  const onShiftBreak = tick.status === 'on_shift_break';
  const onBioBreak   = tick.status === 'on_bio_break';
  const onBreak = onShiftBreak || onBioBreak;

  const bioCount = tick.bio_break_count_today;
  const bioMax   = tick.bio_break_max_per_day ?? 7;
  const bioGrants= tick.bio_break_admin_grants_today;
  const effMax   = bioMax + bioGrants;
  const bioWarnCount = tick.bio_break_warn_count ?? 6;
  const bioTotalToday = tick.bio_break_total_seconds_today;
  const bioWarnTotal  = tick.bio_break_warn_total_seconds ?? 3600;
  const limitReached = bioCount >= effMax;
  const showCountWarn = bioCount >= bioWarnCount && !limitReached;
  const showTotalWarn = bioWarnTotal > 0 && bioTotalToday >= bioWarnTotal;

  const handleShiftBreak = async () => {
    try { await takeShift.mutateAsync(sessionId); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not start shift break'); }
  };
  const handleBioBreak = async () => {
    try {
      const r = await takeBio.mutateAsync(sessionId);
      if (r.needs_request) {
        toast.message('Bio limit reached — request admin approval.');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start bio break');
    }
  };
  const handleRequest = async () => {
    try {
      await createReq.mutateAsync();
      setRequested(true);
      toast.success('Requested — waiting for admin approval.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not request bio break');
    }
  };
  const handleEnd = async () => {
    try { await endBreak.mutateAsync(sessionId); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not end break'); }
  };

  return (
    <div
      // Sits absolute, top-right of BoardContent's relative wrapper,
      // tucked under the countdown chip (which is at top-4 right-8).
      // Same z-40, below the gate (z-50).
      className="absolute top-14 right-8 z-40 flex flex-col items-end gap-1.5 pointer-events-none"
    >
      <div className="inline-flex items-center gap-2 pointer-events-auto">
        {onBreak ? (
          <>
            <span className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] font-medium text-amber-100 bg-amber-900/40 border border-amber-700/40">
              {onBioBreak ? <User className="h-3.5 w-3.5" /> : <Coffee className="h-3.5 w-3.5" />}
              On {onBioBreak ? 'bio' : 'shift'} break · {formatMS(tick.current_break_elapsed_seconds)}
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
        ) : limitReached ? (
          <>
            <button
              type="button"
              onClick={() => void handleShiftBreak()}
              disabled={takeShift.isPending}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] font-semibold text-sky-100 bg-sky-900/40 hover:brightness-110 disabled:opacity-60 border border-sky-700/40"
            >
              <Coffee className="h-3.5 w-3.5" />
              Shift break
            </button>
            <button
              type="button"
              onClick={() => void handleRequest()}
              disabled={createReq.isPending || requested}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] font-semibold text-amber-100 bg-amber-900/40 hover:brightness-110 disabled:opacity-60 border border-amber-700/40"
              title="Your bio break limit is reached — admin must approve another"
            >
              <Send className="h-3.5 w-3.5" />
              {requested ? 'Requested…' : 'Request bio break'}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void handleShiftBreak()}
              disabled={takeShift.isPending}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] font-semibold text-sky-100 bg-sky-900/40 hover:brightness-110 disabled:opacity-60 border border-sky-700/40"
            >
              <Coffee className="h-3.5 w-3.5" />
              Shift break
            </button>
            <button
              type="button"
              onClick={() => void handleBioBreak()}
              disabled={takeBio.isPending}
              className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-[12px] font-semibold text-emerald-100 bg-emerald-900/40 hover:brightness-110 disabled:opacity-60 border border-emerald-700/40"
            >
              <User className="h-3.5 w-3.5" />
              Bio break
            </button>
          </>
        )}
      </div>

      {(showCountWarn || showTotalWarn) && !onBreak && (
        <div className="pointer-events-auto inline-flex flex-col items-end gap-0.5 text-right">
          {showCountWarn && (
            <span className="text-[11px] text-amber-200 bg-amber-900/30 px-2 py-0.5 rounded-full">
              You&apos;ve used {bioCount} of {effMax} bio breaks today.
            </span>
          )}
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
