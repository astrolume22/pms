import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

const EMOJIS = [
  '📋', '📊', '📈', '📌', '📎', '📁', '🗂️', '📅',
  '🎯', '🚀', '💼', '✅', '🎨', '🔧', '⚙️', '💡',
  '🔥', '⭐', '🌟', '🏆', '🎉', '💎', '🎵', '📣',
  '🧠', '✨', '🛠️', '🧩', '📝', '🌐', '🔍', '📦',
];

interface EmojiPickerProps {
  value: string;
  onChange: (emoji: string) => void;
  className?: string;
}

export function EmojiPicker({ value, onChange, className }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div className={cn('relative inline-block', className)} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Pick icon"
        className="h-10 w-10 inline-flex items-center justify-center rounded-base bg-surface border border-border-medium text-xl hover:bg-hover transition-colors duration-100"
      >
        {value}
      </button>
      {open && (
        <div className="absolute left-0 top-12 z-30 bg-surface border border-border-light rounded-md shadow-lg p-2 w-[256px] grid grid-cols-8 gap-1">
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                onChange(e);
                setOpen(false);
              }}
              className={cn(
                'h-7 w-7 inline-flex items-center justify-center rounded-sm text-lg hover:bg-hover',
                value === e && 'bg-selected ring-1 ring-brand',
              )}
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
