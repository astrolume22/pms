import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import type { CellProps } from './cellTypes';
import { readNumberValue } from './cellValue';

interface NumbersSettings {
  unit?: string;
  unit_position?: 'prefix' | 'suffix';
  decimals?: number;
}

export function NumbersCell({ column, value, readonly, isEditing, onStartEdit, onEndEdit, onCommit }: CellProps) {
  const settings = (column.settings ?? {}) as NumbersSettings;
  // Defensive normalize: same envelope bug that hit date/text could
  // wrap a number cell. See cellValue.ts.
  const raw = readNumberValue(value);
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
      className={cn('group/numcell w-full h-full flex items-center justify-end text-[13px]', !readonly && 'cursor-text')}
      onClick={() => !readonly && onStartEdit()}
      style={{
        background: display == null ? 'var(--bg-row)' : undefined,
        padding: '0 var(--cell-pad-x)',
        color: 'var(--text-primary)',
      }}
    >
      {display == null ? (
        !readonly && (
          <span className="text-text-secondary opacity-0 group-hover/numcell:opacity-60 text-[16px] leading-none transition-opacity duration-100">
            +
          </span>
        )
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
