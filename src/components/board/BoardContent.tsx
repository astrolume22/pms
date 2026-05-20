import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Spinner } from '@/components/Spinner';
import type { GroupRow, ColumnRow } from '@/lib/database.types';
import { cn } from '@/lib/cn';

interface BoardContentProps {
  boardId: string;
}

export function BoardContent({ boardId }: BoardContentProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['board', boardId, 'groups+columns'],
    queryFn: async () => {
      const [{ data: groups, error: gErr }, { data: cols, error: cErr }] = await Promise.all([
        supabase
          .from('groups')
          .select('*')
          .eq('board_id', boardId)
          .is('deleted_at', null)
          .order('sort_order'),
        supabase
          .from('columns')
          .select('*')
          .eq('board_id', boardId)
          .is('archived_at', null)
          .order('sort_order'),
      ]);
      if (gErr) throw gErr;
      if (cErr) throw cErr;
      return {
        groups: (groups ?? []) as GroupRow[],
        columns: (cols ?? []) as ColumnRow[],
      };
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner className="h-6 w-6 text-brand" />
      </div>
    );
  }

  const groups = data?.groups ?? [];
  const columns = data?.columns ?? [];

  return (
    <div className="px-8 py-4 space-y-4">
      {groups.map((g) => (
        <GroupBlock key={g.id} group={g} columns={columns} />
      ))}
      <button
        type="button"
        disabled
        className="text-sm text-text-disabled hover:text-text-secondary inline-flex items-center gap-1 cursor-not-allowed"
        title="Groups arrive in Phase 3"
      >
        <Plus className="h-3.5 w-3.5" />
        Add new group
      </button>
    </div>
  );
}

function GroupBlock({ group, columns }: { group: GroupRow; columns: ColumnRow[] }) {
  const [collapsed, setCollapsed] = useState(group.is_collapsed_default);
  return (
    <div className="bg-surface border border-border-light rounded-md overflow-hidden">
      {/* Group header */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-l-4"
        style={{ borderLeftColor: group.color }}
      >
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="h-6 w-6 inline-flex items-center justify-center rounded-sm text-text-secondary hover:bg-hover"
          aria-label={collapsed ? 'Expand group' : 'Collapse group'}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        <span
          className="text-sm font-semibold"
          style={{ color: group.color }}
        >
          {group.name}
        </span>
        <span className="text-xs text-text-disabled ml-2">0 tasks</span>
      </div>

      {!collapsed && (
        <>
          {/* Column header row */}
          <div className="flex items-center border-t border-border-light bg-app/60">
            <div className="w-10 shrink-0" />
            {columns.map((c) => (
              <div
                key={c.id}
                className={cn(
                  'px-3 py-2 text-xs uppercase tracking-wide text-text-secondary font-medium border-r border-border-light last:border-r-0 truncate',
                )}
                style={{ width: c.width }}
              >
                {c.name}
              </div>
            ))}
          </div>

          {/* Empty state */}
          <div className="px-6 py-10 text-center text-sm text-text-secondary">
            <p>No tasks yet.</p>
            <p className="text-xs text-text-disabled mt-1">Tasks arrive in Phase 3.</p>
          </div>
        </>
      )}
    </div>
  );
}
