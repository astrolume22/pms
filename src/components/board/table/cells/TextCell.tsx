import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import type { CellProps } from './cellTypes';

export function TextCell({ value, readonly, isEditing, onStartEdit, onEndEdit, onCommit }: CellProps) {
  const raw = (value as { text?: string } | undefined)?.text ?? '';
  const [draft, setDraft] = useState(raw);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(raw), [raw]);

  useEffect(() => {
    if (isEditing) requestAnimationFrame(() => inputRef.current?.select());
  }, [isEditing]);

  const commit = () => {
    onEndEdit();
    const trimmed = draft;
    if (trimmed === raw) return;
    if (trimmed.trim() === '') onCommit(null);
    else onCommit({ text: trimmed });
  };

  if (isEditing && !readonly) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') { setDraft(raw); onEndEdit(); }
        }}
        className="w-full h-full px-2 bg-surface border border-brand rounded-sm text-sm outline-none"
        autoFocus
      />
    );
  }
  return (
    <div
      className={cn('w-full h-full px-2 flex items-center text-sm truncate', !readonly && 'cursor-text')}
      onClick={() => !readonly && onStartEdit()}
      title={raw}
    >
      {raw || <span className="text-text-disabled">—</span>}
    </div>
  );
}
