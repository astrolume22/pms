/**
 * Anchored popover positioned below/right of an anchor element.
 * Closes on outside click + Escape. Used by all cell editors.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

interface PopoverProps {
  anchorRef: React.RefObject<HTMLElement>;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  minWidth?: number;
  align?: 'start' | 'end';
  /**
   * "chip" variant — premium label-picker styling: darker bg #31314D,
   * 8px corners, hairline white border, deep drop shadow, and a small
   * upward caret anchoring the popover to the cell it opened from.
   * Default keeps the existing surface look used by other cells.
   */
  variant?: 'default' | 'chip';
}

export function Popover({
  anchorRef, open, onClose, children, className, minWidth, align = 'start', variant = 'default',
}: PopoverProps) {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; anchorLeft: number; anchorWidth: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const left = align === 'end' ? rect.right : rect.left;
    // Chip variant offsets a touch more so there's room for the caret.
    const gap = variant === 'chip' ? 10 : 4;
    setPos({
      top: rect.bottom + gap,
      left,
      width: rect.width,
      anchorLeft: rect.left,
      anchorWidth: rect.width,
    });
  }, [open, anchorRef, align, variant]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !pos) return null;

  // Compute caret position so the arrow sits centered under the anchor
  // cell (clamped to stay inside the popover after we know its width).
  // We always position the popover at the anchor's left edge; the caret
  // therefore lives ~half-anchor-width from the popover's left.
  const caretLeft = Math.max(16, Math.min(pos.anchorWidth / 2 - 6, 280));

  const isChip = variant === 'chip';
  return (
    <div
      ref={popRef}
      className={cn(
        'fixed z-50 overflow-visible',
        // Default variant keeps the previous surface look used by every
        // other cell editor (people picker, label-editor modal, etc.).
        !isChip && 'bg-surface border border-border-light rounded-md shadow-lg',
        className,
      )}
      style={{
        top: pos.top,
        left: align === 'end' ? undefined : pos.left,
        right: align === 'end' ? window.innerWidth - pos.left : undefined,
        minWidth: minWidth ?? Math.max(pos.width, 200),
        ...(isChip
          ? {
              // Premium polish: --bg-card surface (#1A1D24), 12px radius,
              // a hairline + deep shadow combined via box-shadow so the
              // popover lifts off the canvas cleanly.
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-card)',
              boxShadow:
                '0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.06)',
            }
          : null),
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Upward caret — only rendered on the chip variant. A rotated
          square with two borders matches the popover's bg + border so
          it reads as a continuous arrow. */}
      {isChip && (
        <span
          aria-hidden="true"
          className="absolute w-[10px] h-[10px] rotate-45"
          style={{
            top: -6,
            left: caretLeft,
            background: 'var(--bg-card)',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        />
      )}
      {children}
    </div>
  );
}
