import { useRef } from 'react';
import { Popover } from '../Popover';
import { DatePopover } from '../DatePopover';
import { cn } from '@/lib/cn';
import type { CellProps } from './cellTypes';

function fmt(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function todayYmd(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function DateCell({ value, readonly, isEditing, onStartEdit, onEndEdit, onCommit }: CellProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const iso = (value as { date?: string | null } | undefined)?.date ?? null;
  const today = todayYmd();

  const isOverdue = iso && iso < today;
  const isToday = iso === today;

  return (
    <>
      <div
        ref={anchorRef}
        className={cn(
          'w-full h-full flex items-center justify-center px-2',
          !readonly && 'cursor-pointer',
        )}
        onClick={() => !readonly && (isEditing ? onEndEdit() : onStartEdit())}
      >
        {iso ? (
          <span
            className={cn(
              'text-[13px] font-medium',
              isOverdue ? 'text-error' : isToday ? 'text-brand' : 'text-text-primary',
            )}
          >
            {fmt(iso)}
          </span>
        ) : (
          <span className="text-[13px] text-text-disabled">—</span>
        )}
      </div>
      <Popover anchorRef={anchorRef} open={isEditing} onClose={onEndEdit} minWidth={280}>
        <DatePopover
          value={iso}
          onChange={(newIso) => {
            onCommit(newIso ? { date: newIso } : null);
            onEndEdit();
          }}
        />
      </Popover>
    </>
  );
}
