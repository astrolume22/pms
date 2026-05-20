import { useActiveUsers } from '@/hooks/users';
import { Avatar } from '@/components/Avatar';
import type { ColumnLabelRow, ColumnRow, ItemRow } from '@/lib/database.types';

interface ColumnFooterProps {
  visibleColumns: ColumnRow[];
  items: ItemRow[];
  valuesByItemColumn: Map<string, unknown>;
  labelsByColumnId: Map<string, ColumnLabelRow[]>;
}

export function ColumnFooter({
  visibleColumns, items, valuesByItemColumn, labelsByColumnId,
}: ColumnFooterProps) {
  return (
    <div className="flex items-stretch border-t border-border-light bg-app/40 text-xs">
      <div className="w-10 shrink-0 border-r border-border-light" />
      {visibleColumns.map((col) => (
        <div
          key={col.id}
          style={{ width: col.width }}
          className="shrink-0 border-r border-border-light last:border-r-0 px-2 py-1.5 flex items-center"
        >
          <FooterCell column={col} items={items} valuesByItemColumn={valuesByItemColumn} labelsByColumnId={labelsByColumnId} />
        </div>
      ))}
    </div>
  );
}

function FooterCell({
  column, items, valuesByItemColumn, labelsByColumnId,
}: {
  column: ColumnRow;
  items: ItemRow[];
  valuesByItemColumn: Map<string, unknown>;
  labelsByColumnId: Map<string, ColumnLabelRow[]>;
}) {
  if (column.column_type === 'task_name') {
    return <span className="text-text-disabled">{items.length} task{items.length === 1 ? '' : 's'}</span>;
  }

  if (column.column_type === 'numbers') {
    let sum = 0; let count = 0;
    for (const it of items) {
      const v = valuesByItemColumn.get(`${it.id}:${column.id}`) as { value?: number } | undefined;
      if (typeof v?.value === 'number') { sum += v.value; count += 1; }
    }
    if (count === 0) return <span className="text-text-disabled">—</span>;
    return <span className="text-text-secondary font-medium">Σ {sum}</span>;
  }

  if (column.column_type === 'checkbox') {
    let done = 0;
    for (const it of items) {
      const v = valuesByItemColumn.get(`${it.id}:${column.id}`) as { checked?: boolean } | undefined;
      if (v?.checked) done += 1;
    }
    return <span className="text-text-secondary">{done}/{items.length}</span>;
  }

  if (column.column_type === 'status' || column.column_type === 'priority') {
    return <DistributionBar column={column} items={items} valuesByItemColumn={valuesByItemColumn} labelsByColumnId={labelsByColumnId} />;
  }

  if (column.column_type === 'dropdown') {
    return <DistributionBar column={column} items={items} valuesByItemColumn={valuesByItemColumn} labelsByColumnId={labelsByColumnId} multi />;
  }

  if (column.column_type === 'people') {
    return <PeopleSummary column={column} items={items} valuesByItemColumn={valuesByItemColumn} />;
  }

  return <span className="text-text-disabled">—</span>;
}

function DistributionBar({
  column, items, valuesByItemColumn, labelsByColumnId, multi,
}: {
  column: ColumnRow; items: ItemRow[];
  valuesByItemColumn: Map<string, unknown>;
  labelsByColumnId: Map<string, ColumnLabelRow[]>;
  multi?: boolean;
}) {
  const labels = labelsByColumnId.get(column.id) ?? [];
  const counts = new Map<string, number>();
  for (const it of items) {
    const v = valuesByItemColumn.get(`${it.id}:${column.id}`);
    if (!v) continue;
    if (multi) {
      const ids = (v as { label_ids?: string[] }).label_ids ?? [];
      for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    } else {
      const id = (v as { label_id?: string }).label_id;
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
  if (total === 0) return <span className="text-text-disabled">—</span>;
  return (
    <div className="flex w-full h-3 rounded-pill overflow-hidden">
      {labels.map((l) => {
        const c = counts.get(l.id) ?? 0;
        if (c === 0) return null;
        const pct = (c / total) * 100;
        return (
          <div
            key={l.id}
            title={`${l.name}: ${c}`}
            style={{ background: l.color, width: `${pct}%` }}
          />
        );
      })}
    </div>
  );
}

function PeopleSummary({
  column, items, valuesByItemColumn,
}: {
  column: ColumnRow; items: ItemRow[];
  valuesByItemColumn: Map<string, unknown>;
}) {
  const { data: users } = useActiveUsers();
  const ids = new Set<string>();
  for (const it of items) {
    const v = valuesByItemColumn.get(`${it.id}:${column.id}`) as { user_ids?: string[] } | undefined;
    if (v?.user_ids) for (const uid of v.user_ids) ids.add(uid);
  }
  const assignees = (users ?? []).filter((u) => ids.has(u.id));
  if (assignees.length === 0) return <span className="text-text-disabled">—</span>;
  return (
    <div className="flex items-center -space-x-1">
      {assignees.slice(0, 5).map((u) => (
        <Avatar key={u.id} name={u.full_name ?? u.username} url={u.avatar_url} size="xs" className="ring-2 ring-surface" />
      ))}
      {assignees.length > 5 && (
        <span className="ml-1 text-text-secondary">+{assignees.length - 5}</span>
      )}
    </div>
  );
}
