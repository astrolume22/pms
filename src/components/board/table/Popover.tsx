/**
 * Anchored popover with VIEWPORT-AWARE smart positioning.
 *
 * Strategy (matches the right-click-menu UX users expect):
 *   1. Measure the trigger via getBoundingClientRect().
 *   2. Render the popover off-screen + invisible on the first frame so
 *      we can measure its rendered width × height.
 *   3. Pick the side with room:
 *        vertical   — try below; if popoverHeight overflows viewport
 *                     bottom, flip to above.
 *        horizontal — start at trigger.left; if popoverWidth overflows
 *                     viewport right, slide the popover leftwards just
 *                     enough to fit; if it then underflows left, clamp
 *                     to the safe-area margin (caret follows the
 *                     trigger so the anchor visually remains tied).
 *   4. After committing the final position, show the popover.
 *
 * Re-measures on window resize while open so a viewport shrink doesn't
 * leave the popover off-screen. Closes on outside click + Escape — same
 * as before.
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
  /**
   * "start" anchors at the trigger's left edge (default); "end" prefers
   * the trigger's right edge. The viewport guard can still slide the
   * popover further to keep it on-screen.
   */
  align?: 'start' | 'end';
  /**
   * "chip" variant — premium label-picker styling: --bg-card surface,
   * 12 radius, deep drop shadow, hairline ring, and a caret anchoring
   * the popover to the trigger when the popover sits below it. The
   * caret hides when we flip the popover above the trigger (or the
   * arrow would point the wrong way).
   */
  variant?: 'default' | 'chip';
}

const VIEWPORT_MARGIN = 8;     // px breathing room from the screen edge
const GAP_DEFAULT     = 4;     // gap between trigger and popover
const GAP_CHIP        = 10;    // extra for the chip-variant caret

interface PlacementState {
  top: number;
  left: number;
  // Did we flip vertically? (governs whether to render the up-caret)
  flippedVertical: boolean;
  // Caret horizontal position relative to popover-left, so the arrow
  // still points at the trigger even when the popover slid sideways.
  caretLeft: number;
  // Measured popover size, kept so a re-render doesn't lose it.
  width: number;
  height: number;
}

export function Popover({
  anchorRef, open, onClose, children, className, minWidth, align = 'start', variant = 'default',
}: PopoverProps) {
  const popRef = useRef<HTMLDivElement>(null);
  // `placement === null` means "measure pass" — render invisible, then
  // place. Once placed, the popover becomes visible.
  const [placement, setPlacement] = useState<PlacementState | null>(null);

  // Recompute on open/resize. useLayoutEffect so the user never sees
  // the first-frame off-screen render — the placement runs before the
  // browser paints.
  useLayoutEffect(() => {
    if (!open) { setPlacement(null); return; }
    const measure = () => {
      const anchor = anchorRef.current;
      const pop    = popRef.current;
      if (!anchor || !pop) return;

      const rect = anchor.getBoundingClientRect();
      // Popover's own rendered size (we mount it off-screen invisible
      // for this measurement on the first pass).
      const popRect = pop.getBoundingClientRect();
      const popW = popRect.width;
      const popH = popRect.height;

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const gap = variant === 'chip' ? GAP_CHIP : GAP_DEFAULT;

      // --- Vertical: prefer below; flip above if no room. ---
      const spaceBelow = vh - rect.bottom - gap - VIEWPORT_MARGIN;
      const spaceAbove = rect.top       - gap - VIEWPORT_MARGIN;
      let top: number;
      let flippedVertical = false;
      if (popH <= spaceBelow) {
        // Fits below — preferred.
        top = rect.bottom + gap;
      } else if (popH <= spaceAbove) {
        // Doesn't fit below but fits above — flip up.
        top = rect.top - gap - popH;
        flippedVertical = true;
      } else {
        // Doesn't fit on either side. Pick whichever has more room and
        // clamp to the viewport so the popover is at least partially
        // visible (scroll/clamp; height stays as-is — caller picks the
        // popover content size, we don't resize).
        if (spaceBelow >= spaceAbove) {
          top = rect.bottom + gap;
          if (top + popH > vh - VIEWPORT_MARGIN) {
            top = Math.max(VIEWPORT_MARGIN, vh - VIEWPORT_MARGIN - popH);
          }
        } else {
          flippedVertical = true;
          top = rect.top - gap - popH;
          if (top < VIEWPORT_MARGIN) top = VIEWPORT_MARGIN;
        }
      }

      // --- Horizontal: anchor per `align`, then slide to fit. ---
      let left = align === 'end' ? rect.right - popW : rect.left;
      // Slide right if we'd underflow the left edge.
      if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
      // Slide left if we'd overflow the right edge.
      if (left + popW > vw - VIEWPORT_MARGIN) {
        left = Math.max(VIEWPORT_MARGIN, vw - VIEWPORT_MARGIN - popW);
      }

      // Caret should still point at the trigger's centre regardless of
      // how far the popover slid. Compute trigger-centre in viewport
      // coords, then convert to popover-relative + clamp inside the
      // popover (with a small margin so the rotated square stays whole).
      const triggerCentreX = (rect.left + rect.right) / 2;
      const caretLeft = Math.max(8, Math.min(popW - 16, triggerCentreX - left - 5));

      setPlacement({ top, left, flippedVertical, caretLeft, width: popW, height: popH });
    };

    // First render: mount off-screen + invisible (placement=null state),
    // then measure on the next frame.
    setPlacement(null);
    const id = requestAnimationFrame(measure);
    const onResize = () => measure();
    window.addEventListener('resize',     onResize);
    window.addEventListener('scroll',     onResize, true);   // capture so we see internal scroll containers too
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [open, anchorRef, align, variant]);

  // Outside click + Escape (unchanged).
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
    document.addEventListener('keydown',   onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown',   onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  // Two render phases:
  //   1. placement === null → mount invisible at (-9999, -9999) so we
  //      can measure the rendered size without flicker.
  //   2. placement set → show it at the computed coords.
  const isMeasuring = placement === null;
  const isChip      = variant === 'chip';

  const baseStyle: React.CSSProperties = isMeasuring
    ? { top: -9999, left: -9999, visibility: 'hidden', pointerEvents: 'none' }
    : { top: placement!.top, left: placement!.left };

  return (
    <div
      ref={popRef}
      className={cn(
        'fixed z-50 overflow-visible',
        !isChip && 'bg-surface border border-border-light rounded-md shadow-lg',
        className,
      )}
      style={{
        ...baseStyle,
        minWidth: minWidth ?? 200,
        ...(isChip
          ? {
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-card)',
              // 8% black drop + 1px hairline ring. The hairline switches
              // sign with the theme so it's always visible against the
              // surrounding canvas.
              boxShadow:
                '0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px var(--overlay-6)',
            }
          : null),
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Caret only when:
            (a) variant === 'chip', AND
            (b) the popover sits BELOW the trigger (a flipped-above
                popover would draw the arrow pointing away from the
                trigger, which reads wrong). */}
      {isChip && !isMeasuring && !placement!.flippedVertical && (
        <span
          aria-hidden="true"
          className="absolute w-[10px] h-[10px] rotate-45"
          style={{
            top: -6,
            left: placement!.caretLeft,
            background: 'var(--bg-card)',
            // Theme-aware caret borders so the arrow stays visible in
            // light mode against the white popover surface.
            borderTop:  '1px solid var(--overlay-8)',
            borderLeft: '1px solid var(--overlay-8)',
          }}
        />
      )}
      {children}
    </div>
  );
}
