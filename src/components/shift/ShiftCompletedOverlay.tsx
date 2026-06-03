/**
 * P4.8 — Shift Completed for Today overlay.
 *
 * Full-cover EIA navy/gold panel shown when shift_tick reports
 * status='completed'. There is no action button — the next calendar
 * day will show the Start Shift gate again (lazy daily reset).
 *
 * Sibling to StartShiftGate + ShiftLockedOverlay. Tone is celebratory
 * (the locked overlay's tone is corrective; this one is congratulatory).
 */
import { BellRing } from 'lucide-react';

const EIA_NAVY = '#0F1E36';
const EIA_GOLD = '#E1B978';

export function ShiftCompletedOverlay() {
  return (
    <div
      // UI FIX: fixed (viewport-anchored) so the popup is dead-center
      // on screen regardless of board content height. See StartShiftGate.
      className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-md"
      style={{ background: 'rgba(15, 30, 54, 0.65)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shift-completed-heading"
    >
      <div
        className="rounded-md shadow-2xl flex flex-col items-center gap-5 mx-4 max-w-md w-full"
        style={{
          background: EIA_NAVY,
          border: `1px solid ${EIA_GOLD}55`,
          padding: '44px 52px',
        }}
      >
        <BellRing className="h-9 w-9" style={{ color: EIA_GOLD }} strokeWidth={1.5} />
        <h2
          id="shift-completed-heading"
          className="text-[36px] leading-none m-0 text-center"
          style={{
            fontFamily: '"Cormorant Garamond", "Cormorant", serif',
            fontWeight: 500,
            color: EIA_GOLD,
            letterSpacing: '0.01em',
          }}
        >
          Shift Complete
        </h2>
        <p
          className="text-[13.5px] text-center m-0 max-w-xs"
          style={{
            color: 'rgba(255,255,255,0.88)',
            letterSpacing: '0.02em',
            lineHeight: 1.55,
          }}
        >
          That&apos;s your 8 hours. Great work. Your shift is closed for the day —
          you can pick up tomorrow when the day resets.
        </p>
      </div>
    </div>
  );
}
