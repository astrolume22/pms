import { useEffect, useRef, useState } from 'react';
import {
  Plus, Table2, LayoutGrid, CalendarDays, MoreHorizontal, Trash2, Pencil,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ViewRow, ViewType } from '@/lib/database.types';
import { useCreateView, useDeleteView, useUpdateView, useViews } from '@/hooks/views';
import { cn } from '@/lib/cn';

interface BoardTabsProps {
  boardId: string;
  activeViewId: string | null;       // null = the built-in "Main table"
  onSwitch: (viewId: string | null) => void;
  canEdit: boolean;
}

const TYPE_ICON: Record<ViewType, React.ReactNode> = {
  table:    <Table2       className="h-4 w-4" />,
  kanban:   <LayoutGrid   className="h-4 w-4" />,
  calendar: <CalendarDays className="h-4 w-4" />,
};

export function BoardTabs({ boardId, activeViewId, onSwitch, canEdit }: BoardTabsProps) {
  const { data: views = [] } = useViews(boardId);
  const create = useCreateView();
  const [addOpen, setAddOpen] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!addOpen) return;
    const h = (e: MouseEvent) => {
      if (addRef.current && !addRef.current.contains(e.target as Node)) setAddOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [addOpen]);

  const onAdd = async (type: ViewType, defaultName: string) => {
    setAddOpen(false);
    try {
      const view = await create.mutateAsync({ boardId, name: defaultName, type });
      onSwitch(view.id);
      toast.success(`${defaultName} added`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add view');
    }
  };

  return (
    <div className="flex items-center gap-1 min-w-0">
      <Tab
        active={activeViewId === null}
        icon={<Table2 className="h-4 w-4" />}
        label="Main table"
        onClick={() => onSwitch(null)}
      />
      {views.map((v) => (
        <ViewTab
          key={v.id}
          view={v}
          active={v.id === activeViewId}
          canEdit={canEdit}
          onClick={() => onSwitch(v.id)}
        />
      ))}
      {canEdit && (
        <div ref={addRef} className="relative">
          <button
            type="button"
            onClick={() => setAddOpen((v) => !v)}
            className="ml-1 h-7 w-7 inline-flex items-center justify-center rounded-button text-text-secondary hover:bg-[var(--overlay-8)] hover:text-text-primary"
            aria-label="Add view"
            title="Add view"
          >
            <Plus className="h-4 w-4" />
          </button>
          {addOpen && (
            <div className="absolute left-0 top-8 z-30 w-56 bg-surface border border-border-light rounded-md shadow-lg overflow-hidden">
              <AddOption icon={TYPE_ICON.kanban}   label="Kanban"   description="Cards grouped by status" onClick={() => onAdd('kanban', 'Kanban')} />
              <AddOption icon={TYPE_ICON.calendar} label="Calendar" description="Items on dates"          onClick={() => onAdd('calendar', 'Calendar')} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Tab({ active, icon, label, onClick }: { active?: boolean; icon: React.ReactNode; label: string; onClick?: () => void }) {
  // Per polish spec: 8/12 padding, 4px gap, 16px icon + 13/500 label.
  // Active = primary text + 2px chip-sky underline; inactive = gray;
  // hover-inactive = 5% white bg @ 8 radius.
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative inline-flex items-center gap-1 py-2 px-3 -mb-px text-[13px] font-medium rounded-button transition-colors duration-100',
        active
          ? 'text-text-primary'
          : 'text-text-secondary hover:text-text-primary hover:bg-[var(--overlay-6)]',
      )}
      style={{ letterSpacing: '0.02em' }}
    >
      {icon}
      <span>{label}</span>
      {active && (
        <span
          aria-hidden="true"
          className="absolute left-1 right-1 -bottom-px h-0.5 rounded-pill"
          style={{ background: 'var(--chip-sky)' }}
        />
      )}
    </button>
  );
}

function ViewTab({ view, active, canEdit, onClick }: {
  view: ViewRow; active: boolean; canEdit: boolean; onClick: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(view.name);
  const update = useUpdateView();
  const del = useDeleteView();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setDraft(view.name), [view.name]);

  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);

  const commitRename = async () => {
    setRenaming(false);
    const t = draft.trim();
    if (!t || t === view.name) { setDraft(view.name); return; }
    try {
      await update.mutateAsync({ id: view.id, boardId: view.board_id, patch: { name: t } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rename failed');
      setDraft(view.name);
    }
  };

  return (
    <div ref={ref} className="relative group/tab">
      <div className="flex items-center">
        <button
          type="button"
          onClick={onClick}
          className={cn(
            'relative inline-flex items-center gap-1 py-2 pl-3 pr-1 -mb-px text-[13px] font-medium rounded-button transition-colors duration-100',
            active
              ? 'text-text-primary'
              : 'text-text-secondary hover:text-text-primary hover:bg-[var(--overlay-6)]',
          )}
          style={{ letterSpacing: '0.02em' }}
        >
          {TYPE_ICON[view.type]}
          {renaming ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => void commitRename()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitRename();
                else if (e.key === 'Escape') { setDraft(view.name); setRenaming(false); }
              }}
              onClick={(e) => e.stopPropagation()}
              className="bg-transparent border-b border-chip-sky px-1 text-[13px] text-text-primary outline-none w-[120px]"
            />
          ) : (
            <span>{view.name}</span>
          )}
          {active && (
            <span
              aria-hidden="true"
              className="absolute left-1 right-1 -bottom-px h-0.5 rounded-pill"
              style={{ background: 'var(--chip-sky)' }}
            />
          )}
        </button>
        {canEdit && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
            aria-label="View menu"
            className={cn(
              'h-6 w-6 mr-1 inline-flex items-center justify-center rounded-sm hover:bg-hover',
              active ? 'opacity-100 text-brand' : 'opacity-0 group-hover/tab:opacity-100 text-text-secondary',
            )}
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {menuOpen && (
        <div className="absolute right-0 top-9 z-30 w-44 bg-surface border border-border-light rounded-md shadow-lg overflow-hidden">
          <button
            onClick={() => { setMenuOpen(false); setRenaming(true); }}
            className="w-full text-left px-3 py-1.5 text-[13px] flex items-center gap-2 hover:bg-hover"
          >
            <Pencil className="h-3.5 w-3.5 text-text-secondary" /> Rename
          </button>
          <button
            onClick={async () => {
              setMenuOpen(false);
              if (!window.confirm(`Delete view "${view.name}"?`)) return;
              try {
                await del.mutateAsync({ id: view.id, boardId: view.board_id });
                toast.success('View deleted');
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Delete failed');
              }
            }}
            className="w-full text-left px-3 py-1.5 text-[13px] flex items-center gap-2 hover:bg-error/10 text-error"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </div>
      )}
    </div>
  );
}

function AddOption({ icon, label, description, onClick }: {
  icon: React.ReactNode; label: string; description: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-hover text-sm"
    >
      <span className="text-text-secondary">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block">{label}</span>
        <span className="block text-[13px] text-text-secondary">{description}</span>
      </span>
    </button>
  );
}
