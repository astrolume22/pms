/**
 * WarningModal — centered EIA navy/gold popup for HIGH-PRIORITY warnings.
 *
 * Single instance lives at the Root level (src/main.tsx, next to the
 * sonner <Toaster/>). State driven by useWarningModalStore — call
 * notifyImportant({title, body}) from anywhere to surface it.
 *
 * Behaviour:
 *   • Auto-focuses "Got it" the moment it opens.
 *   • Auto-dismisses after 12s so it never lingers if the user walks away.
 *   • ESC closes.
 *   • One-slot: a new show() while one is open swaps the content
 *     in-place; we don't stack break warnings.
 *
 * Premium dark theme: navy panel, gold accent, Inter type. Same
 * navy/gold palette family the AccountLockedOverlay uses for visual
 * consistency.
 */
import { useEffect, useRef } from 'react';
import { useWarningModalStore } from '@/state/warningModalStore';

const EIA_NAVY = '#0F1E36';
const EIA_GOLD = '#E1B978';
const AUTO_DISMISS_MS = 12_000;

export function WarningModal() {
  const open  = useWarningModalStore((s) => s.open);
  const title = useWarningModalStore((s) => s.title);
  const body  = useWarningModalStore((s) => s.body);
  const close = useWarningModalStore((s) => s.close);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Auto-focus "Got it" when the modal becomes visible. Re-runs on
  // every open transition (and on body/title change while open, which
  // covers the one-slot swap case).
  useEffect(() => {
    if (!open) return;
    btnRef.current?.focus();
  }, [open, title, body]);

  // 12s auto-dismiss. Re-armed when the content swaps (new title/body
  // → fresh 12s). Cleared on close / unmount.
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(close, AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, [open, title, body, close]);

  // ESC dismisses.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center backdrop-blur-md"
      style={{ background: 'rgba(15, 30, 54, 0.55)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="warning-modal-title"
    >
      <div
        className="rounded-md shadow-2xl flex flex-col items-center gap-5 mx-4 max-w-md w-full"
        style={{
          background: EIA_NAVY,
          border: `1px solid ${EIA_GOLD}33`,
          padding: '36px 44px',
          fontFamily: '"Inter", system-ui, sans-serif',
        }}
      >
        <h2
          id="warning-modal-title"
          className="text-[22px] leading-tight m-0 text-center"
          style={{ fontWeight: 600, color: EIA_GOLD, letterSpacing: '0.01em' }}
        >
          {title}
        </h2>
        {body && (
          <p
            className="text-[14px] text-center m-0"
            style={{ color: 'rgba(255,255,255,0.82)', lineHeight: 1.55 }}
          >
            {body}
          </p>
        )}
        <button
          ref={btnRef}
          type="button"
          onClick={close}
          autoFocus
          className="rounded-md text-[13px] font-semibold transition focus:outline-none focus:ring-2"
          style={{
            background: EIA_GOLD,
            color: EIA_NAVY,
            padding: '10px 24px',
            letterSpacing: '0.02em',
          }}
        >
          Got it
        </button>
      </div>
    </div>
  );
}
