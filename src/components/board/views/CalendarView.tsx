import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { useBoardItems } from '@/hooks/items';
import { useColumns } from '@/hooks/columns';
import { useColumnLabels } from '@/hooks/labels';
import { Spinner } from '@/components/Spinner';
import { EmptyMessage } from '@/components/EmptyMessage';
import type { ColumnRow, ItemRow } from '@/lib/database.types';
import { cn } from '@/lib/cn';

interface CalendarViewProps {
  boardId: string;
  // Which date column to plot items on. Falls back to the first date
  // column on the board.
  dateColumnId?: string;
  // Optional column to colour items by (status or priority).
  colorColumnId?: string;
}

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function CalendarView({ boardId, dateColumnId, colorColumnId }: CalendarViewProps) {
  const { data: items, isLoading: itemsLoading } = useBoardItems(boardId);
  const { data: columns, isLoading: colsLoading } = useColumns(boardId);
  const { data: labelsByColumnId } = useColumnLabels(boardId);
  const navigate = useNavigate();
  const today = new Date();
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));

  const dateCol: ColumnRow | null = useMemo(() => {
    if (!columns) return null;
    if (dateColumnId) return columns.find((c) => c.id === dateColumnId) ?? null;
    return columns.find((c) => c.column_type === 'date') ?? null;
  }, [columns, dateColumnId]);

  const colorCol: ColumnRow | null = useMemo(() => {
    if (!columns) return null;
    if (colorColumnId) return columns.find((c) => c.id === colorColumnId) ?? null;
    return columns.find((c) => c.column_type === 'status') ?? null;
  }, [columns, colorColumnId]);

  // Index items by their date.
  const itemsByDate = useMemo(() => {
    const map = new Map<string, Array<{ item: ItemRow; color: string }>>();
    if (!items || !dateCol) return map;
    for (const it of items.items) {
      if (it.parent_item_id) continue;
      if (it.archived_at) continue;
      const dv = items.valuesByItemColumn.get(`${it.id}:${dateCol.id}`) as { date?: string } | undefined;
      if (!dv?.date) continue;
      // Pick the color from the color column's selected label
      let color = '#579BFC';
      if (colorCol) {
        const cv = items.valuesByItemColumn.get(`${it.id}:${colorCol.id}`) as { label_id?: string } | undefined;
        const lbl = cv?.label_id ? (labelsByColumnId?.get(colorCol.id) ?? []).find((l) => l.id === cv.label_id) : undefined;
        if (lbl) color = lbl.color;
      }
      const arr = map.get(dv.date) ?? [];
      arr.push({ item: it, color });
      map.set(dv.date, arr);
    }
    return map;
  }, [items, dateCol, colorCol, labelsByColumnId]);

  if (itemsLoading || colsLoading) {
    return <div className="flex items-center justify-center py-12"><Spinner className="h-6 w-6 text-brand" /></div>;
  }
  if (!dateCol) {
    return (
      <EmptyMessage
        title="No date column"
        description="Calendar needs a Date column on the board. Add one from the + Add column menu to use this view."
        icon={<CalendarDays className="h-7 w-7" />}
      />
    );
  }

  // Build the grid: Monday-first.
  const firstDay = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const cells: Array<{ iso: string; day: number; inMonth: boolean }> = [];
  // pad previous month
  const prevMonthLast = new Date(cursor.getFullYear(), cursor.getMonth(), 0).getDate();
  for (let i = startOffset - 1; i >= 0; i -= 1) {
    const day = prevMonthLast - i;
    const d = new Date(cursor.getFullYear(), cursor.getMonth() - 1, day);
    cells.push({ iso: ymd(d), day, inMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d += 1) {
    const date = new Date(cursor.getFullYear(), cursor.getMonth(), d);
    cells.push({ iso: ymd(date), day: d, inMonth: true });
  }
  // pad to fill 6 weeks (42 cells)
  while (cells.length < 42) {
    const idx = cells.length - (startOffset + daysInMonth);
    const d = new Date(cursor.getFullYear(), cursor.getMonth() + 1, idx + 1);
    cells.push({ iso: ymd(d), day: d.getDate(), inMonth: false });
  }

  const monthLabel = cursor.toLocaleString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div className="px-8 py-4">
      <div className="flex items-center gap-3 mb-3">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          className="h-8 w-8 inline-flex items-center justify-center rounded-base hover:bg-hover"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <h2 className="text-base font-semibold">{monthLabel}</h2>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          className="h-8 w-8 inline-flex items-center justify-center rounded-base hover:bg-hover"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}
          className="btn-secondary h-8 px-3 text-xs ml-2"
        >
          Today
        </button>
        <span className="ml-auto text-xs text-text-secondary">
          Plotting <strong className="text-text-primary">{dateCol.name}</strong>
          {colorCol && (<> · coloured by <strong className="text-text-primary">{colorCol.name}</strong></>)}
        </span>
      </div>

      <div className="border border-border-light rounded-md overflow-hidden bg-surface">
        <div className="grid grid-cols-7 bg-app/60 border-b border-border-light">
          {WEEKDAYS.map((w) => (
            <div key={w} className="px-2 py-2 text-[11px] uppercase tracking-wide text-text-secondary font-semibold text-center">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((c) => {
            const list = itemsByDate.get(c.iso) ?? [];
            const isToday = ymd(today) === c.iso;
            return (
              <div
                key={c.iso}
                className={cn(
                  'min-h-[96px] border-r border-b border-border-light px-2 py-1 last:border-r-0',
                  !c.inMonth && 'bg-app/30',
                )}
              >
                <span
                  className={cn(
                    'inline-flex items-center justify-center h-5 w-5 text-[11px] font-medium rounded-pill',
                    isToday ? 'bg-brand text-white' : c.inMonth ? 'text-text-primary' : 'text-text-disabled',
                  )}
                >
                  {c.day}
                </span>
                <ul className="mt-1 space-y-1">
                  {list.slice(0, 3).map(({ item, color }) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => navigate({
                          to: '/w/$workspace/b/$boardId',
                          params: { workspace: 'main', boardId },
                          search: { p: item.id },
                        })}
                        className="w-full text-left px-1.5 py-0.5 rounded-sm text-[11px] truncate text-white"
                        style={{ background: color }}
                        title={item.name}
                      >
                        {item.name}
                      </button>
                    </li>
                  ))}
                  {list.length > 3 && (
                    <li className="text-[10px] text-text-secondary px-1">+{list.length - 3} more</li>
                  )}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
