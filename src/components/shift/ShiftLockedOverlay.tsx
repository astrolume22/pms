/**
 * P4.3 — Account-locked overlay.
 *
 * Full-cover blur over the BoardContent area when the manager's session
 * is status='locked' (either auto-triggered by shift_self_period_lock
 * when tick reported period_lock_due, or set by admin via
 * shift_admin_lock). EIA dark theme — navy + gold, Cormorant heading,
 * no emoji. There is INTENTIONALLY no unlock button for the manager;
 * the message tells them to call the admin.
 *
 * Sibling to StartShiftGate. Mounted by ShiftDriver based on tick
 * state. Z-50 above all board layers, same as the Start gate.
 */

const EIA_NAVY = '#0F1E36';
const EIA_GOLD = '#E1B978';

export function ShiftLockedOverlay() {
  return (
    <div
      // UI FIX: fixed (viewport-anchored) so the popup is dead-center
      // on screen regardless of board content height. See StartShiftGate.
      className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-md"
      style={{ background: 'rgba(15, 30, 54, 0.65)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shift-locked-heading"
    >
      <div
        className="rounded-md shadow-2xl flex flex-col items-center gap-5 mx-4 max-w-md w-full"
        style={{
          background: EIA_NAVY,
          border: `1px solid ${EIA_GOLD}55`,
          padding: '44px 52px',
        }}
      >
        <h2
          id="shift-locked-heading"
          className="text-[36px] leading-none m-0 text-center"
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
          className="text-[13.5px] text-center m-0 max-w-xs"
          style={{
            color: 'rgba(255,255,255,0.85)',
            letterSpacing: '0.02em',
            lineHeight: 1.55,
          }}
        >
          Please call your sir to inform him and unlock your account.
        </p>
      </div>
    </div>
  );
}
