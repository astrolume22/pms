/**
 * P4.2 — Shift countdown chip.
 *
 * Top-right of the BoardContent area. Reads remaining_seconds from
 * shift_tick (polled every 10s) and interpolates 1/sec locally between
 * polls. On each server poll it SNAPS to the server value, so refresh /
 * refocus / clock-change cannot add or remove time from the user's day.
 * Clamps at 0:00:00 (the actual 8h-complete LOCK is P4.8).
 *
 * Premium EIA dark — navy chip, gold typeface, tabular nums so the
 * width stays stable as seconds tick.
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import { useShiftTick } from '@/hooks/shift';

const EIA_NAVY = '#0F1E36';
const EIA_GOLD = '#E1B978';

function formatHMS(s: number): string {
  const v = Math.max(0, Math.floor(s));
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  const sec = v % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

interface ShiftCountdownChipProps {
  sessionId: string;
}

export function ShiftCountdownChip({ sessionId }: ShiftCountdownChipProps) {
  const { data: tick } = useShiftTick(sessionId, true);
  const [display, setDisplay] = useState<number | null>(null);
  // Track which server tick we last snapped to so the interpolation
  // effect doesn't restart unnecessarily on every tick.
  const lastSnappedRef = useRef<number | null>(null);

  // Snap to server value on every poll.
  useEffect(() => {
    if (!tick) return;
    if (lastSnappedRef.current !== tick.remaining_seconds) {
      lastSnappedRef.current = tick.remaining_seconds;
      setDisplay(tick.remaining_seconds);
    }
  }, [tick]);

  // Interpolate 1/sec between polls. Only run while the chip has a
  // value to count down and the shift is in a "ticking" state.
  const isTicking = tick?.status === 'active'
    || tick?.status === 'on_shift_break'
    || tick?.status === 'on_bio_break';
  useEffect(() => {
    if (display === null || !isTicking) return;
    const id = setInterval(() => {
      setDisplay((r) => (r === null ? null : Math.max(0, r - 1)));
    }, 1000);
    return () => clearInterval(id);
  }, [isTicking, display === null]);

  if (display === null) return null;

  // P4.3 — while server reports status='locked', show "LOCKED" instead
  // of the ticking time. P4.8 — when status='completed' show "DONE".
  // The matching overlays cover the board anyway; chips stay
  // visually truthful in case the user peeks.
  const isLocked = tick?.status === 'locked';
  const isDone   = tick?.status === 'completed';

  return (
    <div
      // Absolute against BoardContent's outer relative wrapper. Sits at
      // the top-right corner of the groups area, below the BoardToolbar
      // (which is in a different parent). z-40 above board content,
      // below the gate (z-50).
      className="absolute top-4 right-8 z-40 inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full shadow-md select-none pointer-events-none"
      style={{
        background: EIA_NAVY,
        color: EIA_GOLD,
        fontFeatureSettings: '"tnum" on',
        letterSpacing: '0.05em',
        border: `1px solid ${EIA_GOLD}33`,
      }}
      title={isLocked ? 'Shift locked — admin will unlock' : isDone ? 'Shift complete for today' : 'Shift countdown — server-time authoritative'}
      aria-label={isLocked ? 'Shift locked' : isDone ? 'Shift complete' : `Shift countdown ${formatHMS(display)}`}
    >
      <span className="text-[13px] font-semibold tabular-nums">
        {isLocked ? 'LOCKED' : isDone ? 'DONE' : formatHMS(display)}
      </span>
      {!isLocked && !isDone && <ArrowDown className="h-3.5 w-3.5" strokeWidth={2.25} />}
    </div>
  );
}
