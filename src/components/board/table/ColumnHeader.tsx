import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, EyeOff, Trash2, Pencil, Settings, ChevronDown } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/cn';
import type { ColumnRow } from '@/lib/database.types';
import { useDeleteColumn, useUpdateColumn } from '@/hooks/columns';
import { useBoardViewStore } from '@/state/boardViewStore';
import { TASK_NAME_MIN_WIDTH, TASK_NAME_MAX_WIDTH } from './tableLayout';
import { toast } from 'sonner';

interface ColumnHeaderProps {
  column: ColumnRow;
  boardId: string;
  canEdit: boolean;
  onOpenLabelsEditor?: (col: ColumnRow) => void;
}

const MIN_WIDTH = 60;

export function ColumnHeader({ column, boardId, canEdit, onOpenLabelsEditor }: ColumnHeaderProps) {
  const isTaskName = column.column_type === 'task_name';
  const update = useUpdateColumn();
  const remove = useDeleteColumn();
  const setColumnHidden = useBoardViewStore((s) => s.setColumnHidden);

  // task_name column is always pinned-first → no drag for it
  const sortable = useSortable({ id: column.id, disabled: isTaskName || !canEdit });
  // Brief A.4: task_name renders within a 240–360 band regardless of the
  // DB-stored width so the header stays in lock-step with the row above.
  const effectiveWidth = isTaskName
    ? Math.min(TASK_NAME_MAX_WIDTH, Math.max(TASK_NAME_MIN_WIDTH, column.width))
    : column.width;
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    width: effectiveWidth,
  };

  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(column.name);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setDraft(column.name), [column.name]);

  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);

  const commitName = async () => {
    setRenaming(false);
    const t = draft.trim();
    if (!t || t === column.name) { setDraft(column.name); return; }
    try {
      await update.mutateAsync({ id: column.id, boardId, patch: { name: t } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rename failed');
      setDraft(column.name);
    }
  };

  // ----- Resize -----
  // The in-progress draft width lives in the boardViewStore so the
  // header, every data row, and the summary strip all subscribe to
  // the same value and resize together during the drag. The header's
  // local state used to hold this — but data rows didn't read it, so
  // only the header moved while the body stayed put.
  const liveWidth        = useBoardViewStore((s) => s.liveColumnWidths[column.id]);
  const setLiveColWidth  = useBoardViewStore((s) => s.setLiveColumnWidth);
  const resizingRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const onResizeDown = (e: React.PointerEvent) => {
    if (!canEdit) return;
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { startX: e.clientX, startWidth: column.width };

    const onMove = (ev: PointerEvent) => {
      if (!resizingRef.current) return;
      let next = Math.max(MIN_WIDTH, resizingRef.current.startWidth + (ev.clientX - resizingRef.current.startX));
      // task_name has its own band per Brief A.4 — clamp here so the
      // sticky-left cell never escapes the 240-360 window.
      if (isTaskName) {
        next = Math.min(TASK_NAME_MAX_WIDTH, Math.max(TASK_NAME_MIN_WIDTH, next));
      }
      setLiveColWidth(column.id, next);
    };

    const onUp = async () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      // Read the final value from the store (single source of truth)
      // so a closure over a stale React state can't drop the last
      // pointer-move tick.
      const final = useBoardViewStore.getState().liveColumnWidths[column.id] ?? column.width;
      resizingRef.current = null;
      if (final !== column.width) {
        try {
          // mutateAsync runs onMutate FIRST — that's our optimistic
          // cache patch that bumps column.width in the query cache
          // BEFORE we clear the live override below. The order matters:
          // clear too early and the cell falls back to the old cached
          // width for one tick → snap-back flicker.
          await update.mutateAsync({ id: column.id, boardId, patch: { width: final } });
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Resize failed');
        }
      }
      // Drop the live override regardless of success — if the mutation
      // rolled back via onError, column.width is the original anyway
      // and the cell snaps to that (with a toast).
      setLiveColWidth(column.id, null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      ref={sortable.setNodeRef}
      style={{
        ...style,
        // liveWidth (from boardViewStore) is set during a drag-resize
        // and read by EVERY consumer of this column's width — header,
        // ItemRow cells, SummaryStrip cells — so the whole column
        // moves together. Falls back to the persisted width when no
        // drag is in flight.
        width: liveWidth ?? effectiveWidth,
        opacity: sortable.isDragging ? 0.5 : 1,
      }}
      className={cn(
        // Monday-style FILLED BAND: header cell sits inside a single
        // continuous slate band painted by the parent row. We give the
        // cell `bg-header-band` so the sticky task-name cell also keeps
        // the band fill when it slides over the scroll area.
        'group/col relative shrink-0 flex items-center px-3 bg-header-band col-header-text',
        sortable.isDragging && 'z-10',
        isTaskName && 'sticky left-[88px] z-[5] bg-header-band',
      )}
    >
      {/* Per the polish spec: 13/500 ls .02em title-case text in the
          --text-secondary tone. Alignment mirrors the cell below — Task
          name left-aligned, every other column centered. */}
      <div
        className={cn(
          'flex-1 min-w-0 flex items-center gap-1 h-9',
          isTaskName ? 'justify-start' : 'justify-center',
        )}
        {...(canEdit && !isTaskName ? { ...sortable.attributes, ...sortable.listeners } : {})}
      >
        {renaming && canEdit ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commitName()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitName();
              else if (e.key === 'Escape') { setDraft(column.name); setRenaming(false); }
            }}
            className={cn(
              'flex-1 min-w-0 h-6 px-1 bg-transparent border-b border-chip-sky outline-none text-[13px] font-medium text-text-primary',
              !isTaskName && 'text-center',
            )}
            style={{ letterSpacing: '0.02em' }}
          />
        ) : (
          <button
            type="button"
            onDoubleClick={() => canEdit && setRenaming(true)}
            // Bright primary text reads cleanly on the filled header band
            // (white in dark mode, near-black in light mode).
            className="truncate text-left text-[13px] font-medium text-text-primary"
            style={{ letterSpacing: '0.02em' }}
            title={column.name}
          >
            {column.name}
          </button>
        )}
      </div>

      {/* Menu */}
      {canEdit && (
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
            className="opacity-0 group-hover/col:opacity-100 h-5 w-5 inline-flex items-center justify-center rounded-sm hover:bg-hover"
            aria-label="Column menu"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-6 z-30 w-44 bg-surface border border-border-light rounded-md shadow-lg overflow-hidden">
              <button
                type="button"
                onClick={() => { setMenuOpen(false); setRenaming(true); }}
                className="w-full text-left px-3 py-1.5 text-[13px] flex items-center gap-2 hover:bg-hover normal-case tracking-normal"
              >
                <Pencil className="h-3.5 w-3.5 text-text-secondary" />
                Rename
              </button>
              {(column.column_type === 'status'
                || column.column_type === 'priority'
                || column.column_type === 'dropdown') && (
                <button
                  type="button"
                  onClick={() => { setMenuOpen(false); onOpenLabelsEditor?.(column); }}
                  className="w-full text-left px-3 py-1.5 text-[13px] flex items-center gap-2 hover:bg-hover normal-case tracking-normal"
                >
                  <Settings className="h-3.5 w-3.5 text-text-secondary" />
                  Edit labels
                </button>
              )}
              <button
                type="button"
                onClick={() => { setMenuOpen(false); setColumnHidden(column.id, true); }}
                disabled={isTaskName}
                className="w-full text-left px-3 py-1.5 text-[13px] flex items-center gap-2 hover:bg-hover disabled:opacity-40 disabled:cursor-not-allowed normal-case tracking-normal"
              >
                <EyeOff className="h-3.5 w-3.5 text-text-secondary" />
                Hide column
              </button>
              {!isTaskName && (
                <button
                  type="button"
                  onClick={async () => {
                    setMenuOpen(false);
                    if (!window.confirm(`Delete column "${column.name}"? All data in it will be lost.`)) return;
                    try {
                      await remove.mutateAsync({ id: column.id, boardId });
                      toast.success('Column deleted');
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'Delete failed');
                    }
                  }}
                  className="w-full text-left px-3 py-1.5 text-[13px] flex items-center gap-2 hover:bg-error/10 text-error normal-case tracking-normal"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete column
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Sort indicator placeholder */}
      <SortIndicator columnId={column.id} />

      {/* Resize handle */}
      {canEdit && (
        <div
          onPointerDown={onResizeDown}
          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-brand/40"
        />
      )}
    </div>
  );
}

function SortIndicator({ columnId }: { columnId: string }) {
  const sort = useBoardViewStore((s) => s.persisted.sort);
  if (sort?.columnId !== columnId) return null;
  return (
    <span className="ml-1 text-brand">
      <ChevronDown
        className={cn('h-3 w-3 transition-transform', sort.direction === 'asc' && 'rotate-180')}
      />
    </span>
  );
}
