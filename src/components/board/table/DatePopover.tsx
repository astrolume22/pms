import { useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/cn';

interface DatePopoverProps {
  value: string | null;             // 'YYYY-MM-DD'
  onChange: (value: string | null) => void;
}

function ymd(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

export function DatePopover({ value, onChange }: DatePopoverProps) {
  const today = new Date();
  const initial = value ? parseYmd(value) : today;
  const [cursor, setCursor] = useState(new Date(initial.getFullYear(), initial.getMonth(), 1));

  const firstDay = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  // Convert Sun=0..Sat=6 to Mon=0..Sun=6 grid
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();

  const cells: Array<{ day: number; iso: string } | null> = [];
  for (let i = 0; i < startOffset; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) {
    const date = new Date(cursor.getFullYear(), cursor.getMonth(), d);
    cells.push({ day: d, iso: ymd(date) });
  }

  const monthName = cursor.toLocaleString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div className="w-[280px] p-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          className="h-6 w-6 inline-flex items-center justify-center rounded-sm hover:bg-hover"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium">{monthName}</span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          className="h-6 w-6 inline-flex items-center justify-center rounded-sm hover:bg-hover"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS.map((d) => (
          <div key={d} className="text-[10px] uppercase tracking-wide text-text-disabled text-center">{d}</div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          if (!c) return <div key={i} />;
          const isSelected = value === c.iso;
          const isToday = ymd(today) === c.iso;
          return (
            <button
              key={c.iso}
              type="button"
              onClick={() => onChange(c.iso)}
              className={cn(
                'h-7 rounded-sm text-xs inline-flex items-center justify-center hover:bg-hover',
                isSelected && 'bg-brand text-white hover:bg-brand-hover',
                !isSelected && isToday && 'ring-1 ring-brand text-brand',
              )}
            >
              {c.day}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onChange(ymd(new Date()))}
          className="btn-ghost h-7 px-2 text-xs"
        >
          Today
        </button>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-xs text-text-secondary inline-flex items-center gap-1 hover:text-error"
        >
          <X className="h-3 w-3" />
          Clear
        </button>
      </div>
    </div>
  );
}
