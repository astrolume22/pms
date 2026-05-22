import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, EyeOff, Trash2, Pencil, Settings, ChevronDown } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/cn';
import type { ColumnRow } from '@/lib/database.types';
import { useDeleteColumn, useUpdateColumn } from '@/hooks/columns';
import { useBoardViewStore } from '@/state/boardViewStore';
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
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    width: column.width,
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

  // Resize
  const resizingRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [draftWidth, setDraftWidth] = useState<number | null>(null);
  const onResizeDown = (e: React.PointerEvent) => {
    if (!canEdit) return;
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { startX: e.clientX, startWidth: column.width };
    setDraftWidth(column.width);
    const onMove = (ev: PointerEvent) => {
      if (!resizingRef.current) return;
      const next = Math.max(MIN_WIDTH, resizingRef.current.startWidth + (ev.clientX - resizingRef.current.startX));
      setDraftWidth(next);
    };
    const onUp = async () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const final = draftWidthRef.current ?? column.width;
      resizingRef.current = null;
      setDraftWidth(null);
      if (final !== column.width) {
        try { await update.mutateAsync({ id: column.id, boardId, patch: { width: final } }); }
        catch (err) { toast.error(err instanceof Error ? err.message : 'Resize failed'); }
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  // Mirror draftWidth into a ref so onUp sees the latest.
  const draftWidthRef = useRef<number | null>(null);
  useEffect(() => { draftWidthRef.current = draftWidth; }, [draftWidth]);

  return (
    <div
      ref={sortable.setNodeRef}
      style={{
        ...style,
        width: draftWidth ?? column.width,
        opacity: sortable.isDragging ? 0.5 : 1,
      }}
      className={cn(
        // Premium polish: canvas-colored header cell, NO per-cell right
        // border (the 1px gap between header cells comes from the parent
        // row's gap-x; chunk 6 finalizes the 36px row + hairline bottom).
        'group/col relative shrink-0 flex items-center px-3 bg-canvas col-header-text',
        sortable.isDragging && 'z-10',
        isTaskName && 'sticky left-10 z-[5] bg-canvas',
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
            className="truncate text-left text-[13px] font-medium text-text-secondary"
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
                className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-hover normal-case tracking-normal"
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
                  className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-hover normal-case tracking-normal"
                >
                  <Settings className="h-3.5 w-3.5 text-text-secondary" />
                  Edit labels
                </button>
              )}
              <button
                type="button"
                onClick={() => { setMenuOpen(false); setColumnHidden(column.id, true); }}
                disabled={isTaskName}
                className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-hover disabled:opacity-40 disabled:cursor-not-allowed normal-case tracking-normal"
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
                  className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-error/10 text-error normal-case tracking-normal"
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
