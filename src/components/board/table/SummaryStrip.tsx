/**
 * Per-group SUMMARY ROW — Monday-style full-height row.
 *
 * Was a 6px gradient strip below the data rows. NOW: a real 36px row
 * (--row-h, same as a data row) that mirrors the column structure
 * EXACTLY. Each cell:
 *   • Slate-fills with --bg-row (so the row reads as a continuous
 *     mosaic with the rows above).
 *   • Categorical columns (status/priority/dropdown) → stacked color
 *     segments touching with no gap inside the cell. 1px canvas gap
 *     between cells via mr-px (same rule as ItemRow).
 *   • Date / numbers / people / checkbox → similar tone/coverage bar
 *     inside the slate cell.
 *   • Task / Code / Comment cells → slate fill, no bar.
 *
 * Hover a segment → tooltip "Label · N of M (P%)".
 */
import { useActiveUsers } from '@/hooks/users';
import { useBoardViewStore } from '@/state/boardViewStore';
import type { ColumnRow, ColumnLabelRow, ItemRow } from '@/lib/database.types';
import {
  GUTTER_WIDTH,
  COMMENT_COL_WIDTH,
  TASK_CODE_COL_WIDTH,
  TASK_NAME_MIN_WIDTH,
  TASK_NAME_MAX_WIDTH,
} from './tableLayout';
import { chipColorFor, dateToneFor, dateChipColor } from '@/lib/chipColor';

interface SummaryStripProps {
  visibleColumns: ColumnRow[];
  items: ItemRow[];
  valuesByItemColumn: Map<string, unknown>;
  labelsByColumnId: Map<string, ColumnLabelRow[]>;
}

// Match the table's row token so the summary row never desyncs from
// the data rows above it.
const SUMMARY_ROW_HEIGHT = 36;  // px — same as --row-h

export function SummaryStrip({
  visibleColumns, items, valuesByItemColumn, labelsByColumnId,
}: SummaryStripProps) {
  // Mirror ItemRow's ordering: gutter → task_name → comment → task_code → others.
  const taskNameCol = visibleColumns.find((c) => c.column_type === 'task_name');
  const otherCols   = visibleColumns.filter((c) => c.column_type !== 'task_name');
  // Live drag-resize widths — same source ColumnHeader writes to, so
  // the summary cell tracks the header pixel-for-pixel during a drag.
  const liveColumnWidths = useBoardViewStore((s) => s.liveColumnWidths);
  const colWidth = (col: ColumnRow): number => liveColumnWidths[col.id] ?? col.width;

  return (
    <div
      // Full-height row on canvas. Each cell below gets bg-row so the
      // canvas only ever shows through as the 1px gaps between cells.
      className="flex items-stretch bg-canvas border-t border-border-hair"
      style={{ height: SUMMARY_ROW_HEIGHT }}
      aria-label="Group summary"
    >
      {/* Gutter — slate fill, empty. */}
      <div className="shrink-0 border-r border-border-hair bg-row" style={{ width: GUTTER_WIDTH }} />

      {/* Task name — slate fill, NO bar. Width clamped to the brief's
          240–360 band to stay aligned with the row above. Drag-resize
          live width resolved via colWidth() so the summary cell tracks
          the header pixel-for-pixel. */}
      {taskNameCol && (
        <div
          className="shrink-0 border-r border-border-hair bg-row"
          style={{
            width: Math.min(TASK_NAME_MAX_WIDTH, Math.max(TASK_NAME_MIN_WIDTH, colWidth(taskNameCol))),
          }}
        />
      )}

      {/* Comment indicator — slate fill, NO bar. */}
      <div className="shrink-0 border-r border-border-hair bg-row" style={{ width: COMMENT_COL_WIDTH }} />

      {/* Task Code — slate fill, NO bar. */}
      <div className="shrink-0 border-r border-border-hair bg-row" style={{ width: TASK_CODE_COL_WIDTH }} />

      {/* User-defined columns — slate-filled cell with the stacked color
          bar floating in the middle (16px-tall bar, vertically centered
          inside the 36px slate cell). */}
      {otherCols.map((col, idx) => {
        const isLast = idx === otherCols.length - 1;
        return (
          <div
            key={col.id}
            style={{ width: colWidth(col) }}
            className={`shrink-0 bg-row overflow-hidden flex items-center px-2 ${isLast ? '' : 'border-r border-border-hair'}`}
          >
            <div className="w-full h-2.5 overflow-hidden flex" style={{ borderRadius: 2 }}>
              <ColumnSummary
                column={col}
                items={items}
                valuesByItemColumn={valuesByItemColumn}
                labels={labelsByColumnId.get(col.id) ?? []}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface ColumnSummaryProps {
  column: ColumnRow;
  items: ItemRow[];
  valuesByItemColumn: Map<string, unknown>;
  labels: ColumnLabelRow[];
}

function ColumnSummary({ column, items, valuesByItemColumn, labels }: ColumnSummaryProps) {
  // Categorical (single-select)
  if (column.column_type === 'status' || column.column_type === 'priority') {
    return <CategoricalStrip column={column} items={items} valuesByItemColumn={valuesByItemColumn} labels={labels} multi={false} />;
  }
  // Categorical (multi-select)
  if (column.column_type === 'dropdown') {
    return <CategoricalStrip column={column} items={items} valuesByItemColumn={valuesByItemColumn} labels={labels} multi />;
  }
  // Date: tone segments
  if (column.column_type === 'date') {
    return <DateStrip column={column} items={items} valuesByItemColumn={valuesByItemColumn} />;
  }
  // Numbers: coverage (filled vs empty)
  if (column.column_type === 'numbers') {
    return <CoverageStrip column={column} items={items} valuesByItemColumn={valuesByItemColumn} />;
  }
  // People: assignee coverage
  if (column.column_type === 'people') {
    return <PeopleCoverageStrip column={column} items={items} valuesByItemColumn={valuesByItemColumn} />;
  }
  // Checkbox: done/undone
  if (column.column_type === 'checkbox') {
    return <CheckboxStrip column={column} items={items} valuesByItemColumn={valuesByItemColumn} />;
  }
  return null;
}

// ----- Stacked categorical bar ---------------------------------------
function CategoricalStrip({
  column, items, valuesByItemColumn, labels, multi,
}: {
  column: ColumnRow;
  items: ItemRow[];
  valuesByItemColumn: Map<string, unknown>;
  labels: ColumnLabelRow[];
  multi: boolean;
}) {
  const counts = new Map<string, number>();
  let empty = 0;
  for (const it of items) {
    const v = valuesByItemColumn.get(`${it.id}:${column.id}`);
    if (!v) { empty += 1; continue; }
    if (multi) {
      const ids = (v as { label_ids?: string[] }).label_ids ?? [];
      if (ids.length === 0) { empty += 1; continue; }
      for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    } else {
      const id = (v as { label_id?: string }).label_id;
      if (!id) { empty += 1; continue; }
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  const totalAssigned = Array.from(counts.values()).reduce((a, b) => a + b, 0);
  const totalForPct = multi ? Math.max(1, totalAssigned + empty) : Math.max(1, items.length);
  if (items.length === 0) {
    return <div className="h-full w-full" style={{ background: 'var(--overlay-3)' }} />;
  }

  return (
    <div className="flex h-full w-full">
      {labels.map((l, idx) => {
        const c = counts.get(l.id) ?? 0;
        if (c === 0) return null;
        const pct = (c / totalForPct) * 100;
        const color = chipColorFor(column, l, idx, labels.length);
        return (
          <Segment
            key={l.id}
            width={pct}
            background={color}
            tooltip={`${l.name} · ${c} task${c === 1 ? '' : 's'} (${Math.round(pct)}%)`}
          />
        );
      })}
      {empty > 0 && (
        <Segment
          width={(empty / totalForPct) * 100}
          background="var(--overlay-6)"
          tooltip={`No value · ${empty} task${empty === 1 ? '' : 's'}`}
        />
      )}
    </div>
  );
}

// ----- Date tone strip -----------------------------------------------
function DateStrip({
  column, items, valuesByItemColumn,
}: {
  column: ColumnRow;
  items: ItemRow[];
  valuesByItemColumn: Map<string, unknown>;
}) {
  let today = 0, tomorrow = 0, overdue = 0, future = 0, empty = 0;
  for (const it of items) {
    const v = valuesByItemColumn.get(`${it.id}:${column.id}`) as { date?: string | null } | undefined;
    const t = dateToneFor(v?.date ?? null);
    if      (t === 'today')    today    += 1;
    else if (t === 'tomorrow') tomorrow += 1;
    else if (t === 'overdue')  overdue  += 1;
    else if (t === 'future')   future   += 1;
    else                       empty    += 1;
  }
  const total = Math.max(1, items.length);
  const seg = (count: number, color: string, name: string) =>
    count === 0 ? null : (
      <Segment
        width={(count / total) * 100}
        background={color}
        tooltip={`${name} · ${count} task${count === 1 ? '' : 's'} (${Math.round((count / total) * 100)}%)`}
      />
    );
  return (
    <div className="flex h-full w-full">
      {seg(overdue,  dateChipColor('overdue')!,  'Overdue')}
      {seg(today,    dateChipColor('today')!,    'Today')}
      {seg(tomorrow, dateChipColor('tomorrow')!, 'Tomorrow')}
      {seg(future,   'var(--chip-slate)',         'Future')}
      {seg(empty,    'var(--overlay-6)',    'No date')}
    </div>
  );
}

// ----- Numbers coverage ----------------------------------------------
function CoverageStrip({
  column, items, valuesByItemColumn,
}: {
  column: ColumnRow;
  items: ItemRow[];
  valuesByItemColumn: Map<string, unknown>;
}) {
  let filled = 0;
  for (const it of items) {
    const v = valuesByItemColumn.get(`${it.id}:${column.id}`) as { value?: number } | undefined;
    if (typeof v?.value === 'number') filled += 1;
  }
  const total = Math.max(1, items.length);
  const empty = items.length - filled;
  return (
    <div className="flex h-full w-full">
      {filled > 0 && (
        <Segment
          width={(filled / total) * 100}
          background="var(--chip-mint)"
          tooltip={`Has value · ${filled} task${filled === 1 ? '' : 's'}`}
        />
      )}
      {empty > 0 && (
        <Segment
          width={(empty / total) * 100}
          background="var(--overlay-6)"
          tooltip={`No value · ${empty} task${empty === 1 ? '' : 's'}`}
        />
      )}
    </div>
  );
}

// ----- People coverage -----------------------------------------------
function PeopleCoverageStrip({
  column, items, valuesByItemColumn,
}: {
  column: ColumnRow;
  items: ItemRow[];
  valuesByItemColumn: Map<string, unknown>;
}) {
  useActiveUsers();   // keep the existing dependency tree happy
  let assigned = 0;
  for (const it of items) {
    const v = valuesByItemColumn.get(`${it.id}:${column.id}`) as { user_ids?: string[] } | undefined;
    if (v?.user_ids && v.user_ids.length > 0) assigned += 1;
  }
  const total = Math.max(1, items.length);
  const empty = items.length - assigned;
  return (
    <div className="flex h-full w-full">
      {assigned > 0 && (
        <Segment
          width={(assigned / total) * 100}
          background="var(--chip-sky)"
          tooltip={`Assigned · ${assigned} task${assigned === 1 ? '' : 's'}`}
        />
      )}
      {empty > 0 && (
        <Segment
          width={(empty / total) * 100}
          background="var(--overlay-6)"
          tooltip={`Unassigned · ${empty} task${empty === 1 ? '' : 's'}`}
        />
      )}
    </div>
  );
}

// ----- Checkbox done/undone ------------------------------------------
function CheckboxStrip({
  column, items, valuesByItemColumn,
}: {
  column: ColumnRow;
  items: ItemRow[];
  valuesByItemColumn: Map<string, unknown>;
}) {
  let done = 0;
  for (const it of items) {
    const v = valuesByItemColumn.get(`${it.id}:${column.id}`) as { checked?: boolean } | undefined;
    if (v?.checked) done += 1;
  }
  const total = Math.max(1, items.length);
  const undone = items.length - done;
  return (
    <div className="flex h-full w-full">
      {done > 0 && (
        <Segment
          width={(done / total) * 100}
          background="var(--chip-mint)"
          tooltip={`Done · ${done} task${done === 1 ? '' : 's'}`}
        />
      )}
      {undone > 0 && (
        <Segment
          width={(undone / total) * 100}
          background="var(--overlay-6)"
          tooltip={`Open · ${undone} task${undone === 1 ? '' : 's'}`}
        />
      )}
    </div>
  );
}

function Segment({ width, background, tooltip }: { width: number; background: string; tooltip: string }) {
  return (
    <div
      title={tooltip}
      style={{ width: `${width}%`, background }}
      // Slight hover lift so the user knows the segment is interactive
      // (we don't drill down on click — the tooltip carries the data).
      className="h-full hover:brightness-110 transition-[filter] duration-100"
    />
  );
}
