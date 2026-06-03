/**
 * P4.2 — Start Shift gate.
 *
 * Full-cover blur overlay on top of the BoardContent area when the
 * current manager's shift session is still in 'not_started' state for
 * today. One button — Start Shift — calls the server RPC; the optimistic
 * cache update in useShiftStart hides the gate the moment the round-trip
 * succeeds. EIA dark theme (navy + gold), Cormorant heading, no emoji.
 *
 * Mounted only for managers from BoardContent. Admin/super never see it.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { useShiftStart } from '@/hooks/shift';
import { Spinner } from '@/components/Spinner';

// EIA brand swatches — the rest of the app uses oklch chip tokens, but
// this gate is a once-a-day premium moment that should feel distinct.
// Inlined so future theme changes to the board don't drag this with them.
const EIA_NAVY = '#0F1E36';
const EIA_GOLD = '#E1B978';

export function StartShiftGate() {
  const start = useShiftStart();
  const [submitting, setSubmitting] = useState(false);

  const handleStart = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await start.mutateAsync();
      // The optimistic onSuccess in useShiftStart flips the cached
      // status to 'active', which unmounts this component.
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start shift');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      // UI FIX: was `absolute inset-0` against BoardContent's relative
      // wrapper, but that wrapper grows tall with stacked groups so
      // `items-center` was centering vertically far below the viewport.
      // `fixed inset-0` anchors to the viewport so the popup is always
      // dead-center on screen regardless of board content height or
      // scroll position. z-50 still sits above every board layer
      // (per-group sticky-left = z-[5], ghost scrollbar = z-[6]).
      className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-md"
      style={{ background: 'rgba(15, 30, 54, 0.55)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="start-shift-heading"
    >
      <div
        className="rounded-md shadow-2xl flex flex-col items-center gap-5 mx-4 max-w-sm w-full"
        style={{
          background: EIA_NAVY,
          border: `1px solid ${EIA_GOLD}33`,
          padding: '40px 48px',
        }}
      >
        <h2
          id="start-shift-heading"
          className="text-[34px] leading-none m-0"
          style={{
            fontFamily: '"Cormorant Garamond", "Cormorant", serif',
            fontWeight: 500,
            color: EIA_GOLD,
            letterSpacing: '0.01em',
          }}
        >
          Start Your Shift
        </h2>
        <p
          className="text-[13px] text-center m-0"
          style={{
            fontFamily: 'inherit',
            color: 'rgba(255,255,255,0.72)',
            letterSpacing: '0.02em',
          }}
        >
          Press start to begin your work day.
        </p>
        <button
          type="button"
          onClick={() => void handleStart()}
          disabled={submitting}
          className="inline-flex items-center justify-center gap-2 h-11 px-9 rounded-md text-[14px] font-semibold transition-[filter,opacity] duration-100 hover:brightness-110 disabled:opacity-60 disabled:cursor-not-allowed"
          style={{
            background: EIA_GOLD,
            color: EIA_NAVY,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            minWidth: 180,
          }}
        >
          {submitting ? (
            <>
              <Spinner className="h-4 w-4" />
              Starting
            </>
          ) : 'Start Shift'}
        </button>
      </div>
    </div>
  );
}
