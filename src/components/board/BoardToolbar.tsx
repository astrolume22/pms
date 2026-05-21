import { useEffect, useRef, useState } from 'react';
import {
  Search, SlidersHorizontal, ArrowUpDown, EyeOff, Layers, Plus, ChevronDown, Check, X,
} from 'lucide-react';
import { useBoardViewStore, type ItemHeight } from '@/state/boardViewStore';
import { useColumns } from '@/hooks/columns';
import { useCreateItem } from '@/hooks/items';
import { useGroups } from '@/hooks/groups';
import { cn } from '@/lib/cn';
import { toast } from 'sonner';

interface BoardToolbarProps {
  boardId: string;
  canEdit: boolean;
}

export function BoardToolbar({ boardId, canEdit }: BoardToolbarProps) {
  const search = useBoardViewStore((s) => s.search);
  const setSearch = useBoardViewStore((s) => s.setSearch);
  const sort = useBoardViewStore((s) => s.persisted.sort);
  const setSort = useBoardViewStore((s) => s.setSort);
  const hidden = useBoardViewStore((s) => s.persisted.hiddenColumnIds);
  const toggleColumnHidden = useBoardViewStore((s) => s.toggleColumnHidden);
  const groupByColumnId = useBoardViewStore((s) => s.persisted.groupByColumnId);
  const setGroupByColumnId = useBoardViewStore((s) => s.setGroupByColumnId);
  const itemHeight = useBoardViewStore((s) => s.persisted.itemHeight);
  const setItemHeight = useBoardViewStore((s) => s.setItemHeight);

  const { data: columns } = useColumns(boardId);
  const { data: groups } = useGroups(boardId);
  const create = useCreateItem();

  return (
    <div className="px-8 py-3 bg-surface flex items-center gap-1.5 border-b border-border-light flex-wrap">
      {/* New task — admin only. Managers consume the board read-only
          (per docs/PERMISSIONS-REDESIGN-PLAN.md). */}
      {canEdit && (
        <>
          <NewTaskButton
            canEdit={canEdit}
            groups={groups ?? []}
            onCreate={async (groupId) => {
              try {
                await create.mutateAsync({ boardId, groupId, name: 'New task' });
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Could not add task');
              }
            }}
          />
          <div className="h-5 w-px bg-border-light mx-1" />
        </>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-secondary" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search"
          className="h-8 pl-7 pr-7 rounded-base bg-app border border-border-light text-sm outline-none focus:border-brand focus:bg-surface w-[200px]"
        />
        {search && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setSearch('')}
            className="absolute right-1 top-1/2 -translate-y-1/2 h-5 w-5 inline-flex items-center justify-center rounded-sm text-text-secondary hover:bg-hover"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Sort */}
      <SortMenu columns={columns ?? []} sort={sort} onChange={setSort} />

      {/* Hide */}
      <HideMenu
        columns={columns ?? []}
        hiddenIds={hidden}
        onToggle={toggleColumnHidden}
      />

      {/* Group by */}
      <GroupByMenu
        columns={columns ?? []}
        groupByColumnId={groupByColumnId}
        onChange={setGroupByColumnId}
      />

      {/* Item height */}
      <HeightMenu value={itemHeight} onChange={setItemHeight} />

      <div className="ml-auto" />
    </div>
  );
}

// ---------- Sort ----------
function SortMenu({
  columns, sort, onChange,
}: {
  columns: { id: string; name: string; column_type: string }[];
  sort: { columnId: string; direction: 'asc' | 'desc' } | null;
  onChange: (s: { columnId: string; direction: 'asc' | 'desc' } | null) => void;
}) {
  return (
    <ToolbarMenu
      icon={<ArrowUpDown className="h-3.5 w-3.5" />}
      label={sort ? `Sort: ${columns.find((c) => c.id === sort.columnId)?.name ?? 'column'} ${sort.direction === 'asc' ? '↑' : '↓'}` : 'Sort'}
      active={!!sort}
    >
      {(close) => (
        <div className="w-[240px] py-1">
          <button
            type="button"
            onClick={() => { onChange(null); close(); }}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-hover text-text-secondary"
          >
            Clear sort
          </button>
          <div className="h-px bg-border-light my-1" />
          {columns.map((c) => (
            <div key={c.id} className="flex items-center px-1">
              <button
                type="button"
                onClick={() => { onChange({ columnId: c.id, direction: 'asc' }); close(); }}
                className={cn(
                  'flex-1 text-left px-2 py-1.5 text-xs rounded-sm hover:bg-hover',
                  sort?.columnId === c.id && sort.direction === 'asc' && 'bg-selected text-brand font-medium',
                )}
              >
                {c.name} ↑
              </button>
              <button
                type="button"
                onClick={() => { onChange({ columnId: c.id, direction: 'desc' }); close(); }}
                className={cn(
                  'flex-1 text-left px-2 py-1.5 text-xs rounded-sm hover:bg-hover',
                  sort?.columnId === c.id && sort.direction === 'desc' && 'bg-selected text-brand font-medium',
                )}
              >
                {c.name} ↓
              </button>
            </div>
          ))}
        </div>
      )}
    </ToolbarMenu>
  );
}

// ---------- Hide columns ----------
function HideMenu({ columns, hiddenIds, onToggle }: {
  columns: { id: string; name: string; column_type: string }[];
  hiddenIds: string[];
  onToggle: (id: string) => void;
}) {
  const visibleCount = columns.filter((c) => !hiddenIds.includes(c.id)).length;
  return (
    <ToolbarMenu
      icon={<EyeOff className="h-3.5 w-3.5" />}
      label={hiddenIds.length > 0 ? `Hide (${columns.length - visibleCount})` : 'Hide'}
      active={hiddenIds.length > 0}
    >
      {() => (
        <div className="w-[240px] py-1 max-h-[300px] overflow-y-auto">
          {columns.map((c) => {
            const isHidden = hiddenIds.includes(c.id);
            const isTaskName = c.column_type === 'task_name';
            return (
              <button
                key={c.id}
                type="button"
                disabled={isTaskName}
                onClick={() => onToggle(c.id)}
                className={cn(
                  'w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-hover',
                  isTaskName && 'opacity-40 cursor-not-allowed',
                )}
              >
                <span className="h-3.5 w-3.5 inline-flex items-center justify-center border border-border-medium rounded-sm">
                  {!isHidden && <Check className="h-3 w-3 text-brand" />}
                </span>
                <span className="flex-1 truncate">{c.name}</span>
                {isTaskName && <span className="text-[10px] text-text-disabled">(required)</span>}
              </button>
            );
          })}
        </div>
      )}
    </ToolbarMenu>
  );
}

// ---------- Group by ----------
function GroupByMenu({ columns, groupByColumnId, onChange }: {
  columns: { id: string; name: string; column_type: string }[];
  groupByColumnId: string | null;
  onChange: (id: string | null) => void;
}) {
  const groupable = columns.filter(
    (c) => c.column_type === 'status' || c.column_type === 'priority' || c.column_type === 'people',
  );
  const label = groupByColumnId
    ? `Group by: ${columns.find((c) => c.id === groupByColumnId)?.name ?? 'column'}`
    : 'Group by';
  return (
    <ToolbarMenu icon={<Layers className="h-3.5 w-3.5" />} label={label} active={!!groupByColumnId}>
      {(close) => (
        <div className="w-[240px] py-1">
          <button
            type="button"
            onClick={() => { onChange(null); close(); }}
            className={cn(
              'w-full text-left px-3 py-1.5 text-xs hover:bg-hover',
              groupByColumnId === null && 'font-medium text-brand',
            )}
          >
            By group (default)
          </button>
          <div className="h-px bg-border-light my-1" />
          {groupable.length === 0 && <p className="px-3 py-1.5 text-xs text-text-disabled">No groupable columns</p>}
          {groupable.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => { onChange(c.id); close(); }}
              className={cn(
                'w-full text-left px-3 py-1.5 text-xs hover:bg-hover',
                groupByColumnId === c.id && 'bg-selected text-brand font-medium',
              )}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
    </ToolbarMenu>
  );
}

// ---------- Item height ----------
function HeightMenu({ value, onChange }: { value: ItemHeight; onChange: (h: ItemHeight) => void }) {
  const options: ItemHeight[] = ['compact', 'comfortable', 'spacious'];
  return (
    <ToolbarMenu icon={<SlidersHorizontal className="h-3.5 w-3.5" />} label="Density">
      {(close) => (
        <div className="w-[160px] py-1">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => { onChange(opt); close(); }}
              className={cn(
                'w-full text-left px-3 py-1.5 text-xs capitalize hover:bg-hover',
                value === opt && 'bg-selected text-brand font-medium',
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </ToolbarMenu>
  );
}

// ---------- New task split button ----------
function NewTaskButton({
  canEdit, groups, onCreate,
}: {
  canEdit: boolean;
  groups: { id: string; name: string; color: string }[];
  onCreate: (groupId: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const disabled = !canEdit || groups.length === 0;
  const firstGroup = groups[0];

  return (
    <div ref={ref} className="relative inline-flex">
      {/* Main action: adds to the first group at the bottom (default). */}
      <button
        type="button"
        disabled={disabled}
        onClick={async () => {
          if (!firstGroup) return;
          await onCreate(firstGroup.id);
        }}
        className="inline-flex items-center h-8 pl-3 pr-2 rounded-l-base bg-brand text-white text-sm font-medium hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed"
      >
        New task
      </button>
      {/* Chevron toggles the per-group dropdown. */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Choose group for new task"
        className={cn(
          'inline-flex items-center justify-center h-8 w-7 rounded-r-base bg-brand text-white text-sm border-l border-white/20 hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed',
          open && 'bg-brand-hover',
        )}
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-9 z-30 w-56 bg-surface border border-border-light rounded-md shadow-lg overflow-hidden py-1"
        >
          <p className="px-3 py-1 text-[10px] uppercase tracking-wide text-text-disabled font-medium">
            Add to group
          </p>
          {groups.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={async () => {
                setOpen(false);
                await onCreate(g.id);
              }}
              className="w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-hover"
            >
              <span className="h-3 w-3 rounded-sm shrink-0" style={{ background: g.color }} />
              <span className="truncate">{g.name}</span>
            </button>
          ))}
          {groups.length === 0 && (
            <p className="px-3 py-2 text-xs text-text-disabled">No groups on this board</p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Shared menu primitive ----------
function ToolbarMenu({
  icon, label, active, children,
}: {
  icon: React.ReactNode; label: string; active?: boolean;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-base text-xs font-medium transition-colors duration-100',
          active
            ? 'bg-selected text-brand'
            : 'text-text-secondary hover:bg-hover hover:text-text-primary',
        )}
      >
        {icon}
        <span>{label}</span>
      </button>
      {open && (
        <div className="absolute left-0 top-9 z-30 bg-surface border border-border-light rounded-md shadow-lg overflow-hidden">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

// Re-export the Add button for use elsewhere
export function AddSomethingButton({ disabled }: { disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} className="btn-ghost h-8 px-2 text-xs">
      <Plus className="h-3.5 w-3.5" />
    </button>
  );
}
