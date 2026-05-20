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
}

export function Popover({
  anchorRef, open, onClose, children, className, minWidth, align = 'start',
}: PopoverProps) {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const left = align === 'end' ? rect.right : rect.left;
    setPos({ top: rect.bottom + 4, left, width: rect.width });
  }, [open, anchorRef, align]);

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
  return (
    <div
      ref={popRef}
      className={cn(
        'fixed z-50 bg-surface border border-border-light rounded-md shadow-lg overflow-hidden',
        className,
      )}
      style={{
        top: pos.top,
        left: align === 'end' ? undefined : pos.left,
        right: align === 'end' ? window.innerWidth - pos.left : undefined,
        minWidth: minWidth ?? Math.max(pos.width, 200),
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
}
