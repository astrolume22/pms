import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import type { CellProps } from './cellTypes';

interface NumbersSettings {
  unit?: string;
  unit_position?: 'prefix' | 'suffix';
  decimals?: number;
}

export function NumbersCell({ column, value, readonly, isEditing, onStartEdit, onEndEdit, onCommit }: CellProps) {
  const settings = (column.settings ?? {}) as NumbersSettings;
  const raw = (value as { value?: number | null } | undefined)?.value ?? null;
  const [draft, setDraft] = useState(raw == null ? '' : String(raw));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(raw == null ? '' : String(raw)), [raw]);
  useEffect(() => { if (isEditing) requestAnimationFrame(() => inputRef.current?.select()); }, [isEditing]);

  const commit = () => {
    onEndEdit();
    if (draft.trim() === '') {
      if (raw != null) onCommit(null);
      return;
    }
    const n = Number(draft);
    if (Number.isNaN(n)) {
      setDraft(raw == null ? '' : String(raw));
      return;
    }
    if (n === raw) return;
    onCommit({ value: n });
  };

  if (isEditing && !readonly) {
    return (
      <input
        ref={inputRef}
        type="number"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') { setDraft(raw == null ? '' : String(raw)); onEndEdit(); }
        }}
        className="w-full h-full px-3 text-right bg-surface border border-brand rounded-sm text-[14px] outline-none"
        autoFocus
      />
    );
  }

  const display = raw == null
    ? null
    : settings.decimals != null
      ? raw.toFixed(settings.decimals)
      : String(raw);

  return (
    <div
      className={cn('w-full h-full px-3 flex items-center justify-end text-[14px]', !readonly && 'cursor-text')}
      onClick={() => !readonly && onStartEdit()}
    >
      {display == null ? (
        <span className="text-text-disabled">—</span>
      ) : (
        <span>
          {settings.unit_position === 'prefix' && settings.unit ? settings.unit : ''}
          {display}
          {settings.unit_position !== 'prefix' && settings.unit ? settings.unit : ''}
        </span>
      )}
    </div>
  );
}
