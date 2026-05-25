import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import type { CellProps } from './cellTypes';
import { readTextValue } from './cellValue';

export function TextCell({ value, readonly, isEditing, onStartEdit, onEndEdit, onCommit }: CellProps) {
  // Normalize across all stored shapes: canonical {text}, MCP-wrapped
  // {value:'{"text":"…"}'}, or plain string. See cellValue.ts.
  const raw = readTextValue(value);
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
        className="w-full h-full px-3 bg-surface border border-brand rounded-sm text-[14px] outline-none"
        autoFocus
      />
    );
  }
  return (
    <div
      // Empty cells get the slate row fill + a hover "+" cue — no
      // em-dash anywhere (criterion 14).
      className={cn('group/textcell w-full h-full flex items-center text-[13px] truncate', !readonly && 'cursor-text')}
      onClick={() => !readonly && onStartEdit()}
      title={raw}
      style={{
        background: raw ? undefined : 'var(--bg-row)',
        padding: '0 var(--cell-pad-x)',
        color: 'var(--text-primary)',
      }}
    >
      {raw || (
        !readonly && (
          <span className="text-text-secondary opacity-0 group-hover/textcell:opacity-60 text-[16px] leading-none transition-opacity duration-100">
            +
          </span>
        )
      )}
    </div>
  );
}
