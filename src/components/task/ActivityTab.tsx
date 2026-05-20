import { useMemo } from 'react';
import { Clock } from 'lucide-react';
import { useItemActivity } from '@/hooks/activity';
import { useActiveUsers } from '@/hooks/users';
import { useColumns } from '@/hooks/columns';
import { useColumnLabels } from '@/hooks/labels';
import { Avatar } from '@/components/Avatar';
import { Spinner } from '@/components/Spinner';
import { EmptyMessage } from '@/components/EmptyMessage';
import type { ActivityLogRow, ColumnRow, ColumnLabelRow } from '@/lib/database.types';

interface ActivityTabProps {
  itemId: string;
  boardId: string;
}

export function ActivityTab({ itemId, boardId }: ActivityTabProps) {
  const { data, isLoading } = useItemActivity(itemId);
  const { data: users } = useActiveUsers();
  const { data: columns } = useColumns(boardId);
  const { data: labelsByColumnId } = useColumnLabels(boardId);

  const columnById = useMemo(() => {
    const m = new Map<string, ColumnRow>();
    for (const c of columns ?? []) m.set(c.id, c);
    return m;
  }, [columns]);

  if (isLoading) {
    return <div className="flex items-center justify-center py-6"><Spinner className="h-5 w-5 text-brand" /></div>;
  }
  if (!data || data.length === 0) {
    return <EmptyMessage title="No activity yet" description="Edits to this task will appear here." icon={<Clock className="h-6 w-6" />} />;
  }

  return (
    <ul className="space-y-2">
      {data.map((row) => (
        <ActivityRow
          key={row.id}
          row={row}
          actor={users?.find((u) => u.id === row.actor_id)}
          columnById={columnById}
          labelsByColumnId={labelsByColumnId ?? new Map()}
          users={users ?? []}
        />
      ))}
    </ul>
  );
}

interface ActivityRowProps {
  row: ActivityLogRow;
  actor?: { id: string; username: string; full_name: string | null; avatar_url: string | null };
  columnById: Map<string, ColumnRow>;
  labelsByColumnId: Map<string, ColumnLabelRow[]>;
  users: { id: string; username: string; full_name: string | null }[];
}

function ActivityRow({ row, actor, columnById, labelsByColumnId, users }: ActivityRowProps) {
  const actorName = actor?.full_name ?? actor?.username ?? 'Someone';
  return (
    <li className="flex items-start gap-2 px-1 py-1.5">
      <Avatar name={actorName} url={actor?.avatar_url ?? null} size="sm" />
      <div className="flex-1 min-w-0">
        <p className="text-sm">
          <span className="font-medium">{actorName}</span>{' '}
          <span className="text-text-secondary">{renderMessage(row, columnById, labelsByColumnId, users)}</span>
        </p>
        <p className="text-[11px] text-text-disabled">{relativeTime(row.created_at)}</p>
      </div>
    </li>
  );
}

function renderMessage(
  row: ActivityLogRow,
  columnById: Map<string, ColumnRow>,
  labelsByColumnId: Map<string, ColumnLabelRow[]>,
  users: { id: string; username: string; full_name: string | null }[],
): string {
  switch (row.action_type) {
    case 'item_created':   return 'created this task';
    case 'item_renamed': {
      const o = (row.old_value as { name?: string } | null)?.name;
      const n = (row.new_value as { name?: string } | null)?.name;
      return `renamed it ${o ? `from "${o}" ` : ''}to "${n ?? '—'}"`;
    }
    case 'item_archived':  return 'archived this task';
    case 'item_restored':  return 'restored this task';
    case 'item_deleted':   return 'deleted this task';
    case 'update_added':   return 'posted an update';
    case 'file_uploaded': {
      const name = (row.new_value as { name?: string } | null)?.name ?? 'a file';
      return `uploaded ${name}`;
    }
    case 'value_changed': {
      const old = row.old_value as { column_id?: string; value?: unknown } | null;
      const next = row.new_value as { column_id?: string; value?: unknown } | null;
      const colId = next?.column_id ?? old?.column_id;
      const col = colId ? columnById.get(colId) : null;
      if (!col) return 'changed a cell';
      const fromText = describeValue(col, old?.value, labelsByColumnId, users);
      const toText = describeValue(col, next?.value, labelsByColumnId, users);
      if (!fromText) return `set ${col.name} to ${toText || '—'}`;
      if (!toText)   return `cleared ${col.name} (was ${fromText})`;
      return `changed ${col.name} from ${fromText} to ${toText}`;
    }
    default: return row.action_type.replaceAll('_', ' ');
  }
}

function describeValue(
  col: ColumnRow,
  value: unknown,
  labelsByColumnId: Map<string, ColumnLabelRow[]>,
  users: { id: string; username: string; full_name: string | null }[],
): string {
  if (value == null) return '';
  switch (col.column_type) {
    case 'text':     return `"${((value as { text?: string }).text ?? '').slice(0, 60)}"`;
    case 'numbers':  return String((value as { value?: number }).value ?? '');
    case 'checkbox': return (value as { checked?: boolean }).checked ? 'checked' : 'unchecked';
    case 'date':     return (value as { date?: string }).date ?? '';
    case 'link':     return (value as { url?: string }).url ?? '';
    case 'status':
    case 'priority': {
      const id = (value as { label_id?: string }).label_id;
      const lbl = (labelsByColumnId.get(col.id) ?? []).find((l) => l.id === id);
      return lbl ? `"${lbl.name}"` : '';
    }
    case 'dropdown': {
      const ids = (value as { label_ids?: string[] }).label_ids ?? [];
      const names = ids
        .map((id) => (labelsByColumnId.get(col.id) ?? []).find((l) => l.id === id)?.name)
        .filter((n): n is string => !!n);
      return names.length ? names.join(', ') : '';
    }
    case 'people': {
      const ids = (value as { user_ids?: string[] }).user_ids ?? [];
      const names = ids
        .map((id) => users.find((u) => u.id === id))
        .filter((u): u is NonNullable<typeof u> => !!u)
        .map((u) => `@${u.username}`);
      return names.join(', ');
    }
    default: return '';
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleString();
}
