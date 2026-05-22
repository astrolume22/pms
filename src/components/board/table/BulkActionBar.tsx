import { useEffect, useRef, useState } from 'react';
import { Archive, Trash2, FolderInput, X } from 'lucide-react';
import { useBoardViewStore } from '@/state/boardViewStore';
import { useBulkItemAction } from '@/hooks/items';
import type { GroupRow } from '@/lib/database.types';
import { toast } from 'sonner';

interface BulkActionBarProps {
  boardId: string;
  groups: GroupRow[];
  canEdit: boolean;
}

export function BulkActionBar({ boardId, groups, canEdit }: BulkActionBarProps) {
  const selected = useBoardViewStore((s) => s.selectedItemIds);
  const clear = useBoardViewStore((s) => s.clearSelected);
  const bulk = useBulkItemAction();
  const [moveOpen, setMoveOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moveOpen) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMoveOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [moveOpen]);

  if (selected.size === 0) return null;
  const ids = Array.from(selected);

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      // Hard-code a near-black bg so it stays dark in BOTH light and dark
      // mode. Using bg-text-primary would flip to a light grey in dark mode
      // and the white text would disappear into the background.
      style={{ background: '#1F2128' }}
      className="fixed left-1/2 -translate-x-1/2 bottom-6 z-40 text-white rounded-md shadow-xl flex items-center gap-1 px-2 py-2"
    >
      <span className="px-3 text-sm font-medium text-white">{ids.length} selected</span>
      <div className="h-5 w-px bg-white/20 mx-1" />
      <BulkBtn
        icon={<Archive className="h-3.5 w-3.5" />}
        label="Archive"
        onClick={async () => {
          try {
            await bulk.mutateAsync({ kind: 'archive', boardId, ids });
            toast.success(`Archived ${ids.length} task${ids.length === 1 ? '' : 's'}`);
            clear();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Archive failed');
          }
        }}
        disabled={!canEdit}
      />
      <div ref={ref} className="relative">
        <BulkBtn
          icon={<FolderInput className="h-3.5 w-3.5" />}
          label="Move to"
          onClick={() => setMoveOpen((v) => !v)}
          disabled={!canEdit}
        />
        {moveOpen && (
          <div className="absolute left-0 bottom-10 w-52 max-h-60 overflow-y-auto bg-surface text-text-primary border border-border-light rounded-md shadow-lg z-50">
            {groups.length === 0 && (
              <p className="px-3 py-2 text-[13px] text-text-disabled">No groups</p>
            )}
            {groups.map((g) => (
              <button
                key={g.id}
                onClick={async () => {
                  setMoveOpen(false);
                  try {
                    await bulk.mutateAsync({ kind: 'move', boardId, ids, groupId: g.id });
                    toast.success(`Moved ${ids.length} to "${g.name}"`);
                    clear();
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Move failed');
                  }
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-hover flex items-center gap-2"
              >
                <span className="h-3 w-3 rounded-sm" style={{ background: g.color }} />
                <span className="truncate">{g.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <BulkBtn
        icon={<Trash2 className="h-3.5 w-3.5" />}
        label="Delete"
        destructive
        onClick={async () => {
          if (!window.confirm(`Delete ${ids.length} task${ids.length === 1 ? '' : 's'}?`)) return;
          try {
            await bulk.mutateAsync({ kind: 'delete', boardId, ids });
            toast.success(`Deleted ${ids.length} task${ids.length === 1 ? '' : 's'}`);
            clear();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Delete failed');
          }
        }}
        disabled={!canEdit}
      />
      <div className="h-5 w-px bg-white/20 mx-1" />
      <button
        type="button"
        onClick={clear}
        aria-label="Clear selection"
        className="h-7 w-7 inline-flex items-center justify-center rounded-sm hover:bg-white/10"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function BulkBtn({ icon, label, onClick, destructive, disabled }: {
  icon: React.ReactNode; label: string; onClick: () => void; destructive?: boolean; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        'h-7 px-2 inline-flex items-center gap-1.5 rounded-sm text-[13px] font-medium hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed '
        // Use a bright coral for destructive so it stays readable on the
        // near-black bar in both light + dark themes (the regular --error
        // var renders too dim against #1F2128 in dark mode).
        + (destructive ? 'text-[#FF7A8A]' : 'text-white')
      }
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
