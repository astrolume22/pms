/**
 * P-AccountLock (0064) — Account-Locked overlay.
 *
 * Mounted by ShiftDriver BEFORE the not_started → StartShiftGate branch
 * whenever the manager's `shift_my_account_lock()` returns
 * account_locked = true. Sibling to StartShiftGate / ShiftLockedOverlay
 * / ShiftCompletedOverlay; reuses the same EIA navy/gold theme so the
 * full-cover overlays feel like one family.
 *
 * Server enforcement: shift_start() raises 'account locked' (42501) on
 * a locked account, so even if the candidate bypasses this overlay
 * (open DevTools, hit the RPC directly), the start still fails.
 *
 * Tone is calm and no-blame per the global warm-copy rule. No emoji,
 * no Start button — the path forward is "contact admin", not retry.
 */
const EIA_NAVY = '#0F1E36';
const EIA_GOLD = '#E1B978';

export function AccountLockedOverlay() {
  return (
    <div
      // fixed inset-0 anchors to the viewport so the panel is dead
      // center regardless of board content height or scroll position —
      // same approach the StartShiftGate uses.
      className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-md"
      style={{ background: 'rgba(15, 30, 54, 0.55)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-locked-heading"
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
          id="account-locked-heading"
          className="text-[32px] leading-none m-0 text-center"
          style={{
            fontFamily: '"Cormorant Garamond", "Cormorant", serif',
            fontWeight: 500,
            color: EIA_GOLD,
            letterSpacing: '0.01em',
          }}
        >
          Account Locked
        </h2>
        <p
          className="text-[13.5px] text-center m-0"
          style={{
            fontFamily: 'inherit',
            color: 'rgba(255,255,255,0.82)',
            letterSpacing: '0.01em',
            lineHeight: 1.55,
          }}
        >
          Your account is currently locked. Please contact your admin to continue.
        </p>
        <p
          className="text-[11.5px] text-center m-0"
          style={{
            color: 'rgba(255,255,255,0.45)',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          Shift start is paused until your admin unlocks the account.
        </p>
      </div>
    </div>
  );
}
