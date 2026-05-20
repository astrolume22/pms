/**
 * Shared content between the slide-in panel and the full task page.
 *
 * Renders: header (icon + name + code + breadcrumb), TaskFieldsZone,
 * tabs (Updates / Files / Activity), subitems section, labels editor
 * modal (controlled here so all tabs share it).
 */
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  X, Maximize2, ChevronRight, MessageSquare, Paperclip, Clock, MoreHorizontal,
} from 'lucide-react';
import { toast } from 'sonner';
import type { BoardWithOwner } from '@/hooks/boards';
import { useBoardItems, useRenameItem } from '@/hooks/items';
import { useColumns } from '@/hooks/columns';
import { useColumnLabels } from '@/hooks/labels';
import { useAuthStore } from '@/state/authStore';
import { TaskFieldsZone } from './TaskFieldsZone';
import { UpdatesTab } from './UpdatesTab';
import { FilesTab } from './FilesTab';
import { ActivityTab } from './ActivityTab';
import { SubitemsSection } from './SubitemsSection';
import { LabelsEditorModal } from '@/components/board/table/LabelsEditorModal';
import { Spinner } from '@/components/Spinner';
import { cn } from '@/lib/cn';
import type { ColumnRow, ItemRow } from '@/lib/database.types';

type Tab = 'updates' | 'files' | 'activity';

interface TaskDetailProps {
  board: BoardWithOwner;
  itemId: string;
  // Container chrome — varies between panel and full page
  variant: 'panel' | 'full';
  // Panel-only: close handler + expand-to-full
  onClose?: () => void;
  fullPageHref?: string;
  // For panel: switching to a subitem inside the same overlay
  onOpenItem?: (id: string) => void;
}

export function TaskDetail({
  board, itemId, variant, onClose, fullPageHref, onOpenItem,
}: TaskDetailProps) {
  const profile = useAuthStore((s) => s.profile);
  const qc = useQueryClient();

  const { data: itemsData, isLoading: itemsLoading } = useBoardItems(board.id);
  const { data: columns, isLoading: colsLoading } = useColumns(board.id);
  const { data: labelsByColumnId } = useColumnLabels(board.id);

  const item = itemsData?.items.find((i) => i.id === itemId) ?? null;

  const canEdit =
    !!profile &&
    (profile.role === 'admin'
      || profile.is_super_admin
      || board.owner_id === profile.id
      || profile.role === 'manager');

  const [tab, setTab] = useState<Tab>('updates');
  const [labelsForColumn, setLabelsForColumn] = useState<ColumnRow | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');
  const rename = useRenameItem();

  // Re-init draft when the item changes
  useState(() => { setDraftName(item?.name ?? ''); return null; });

  if (itemsLoading || colsLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner className="h-6 w-6 text-brand" />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-text-secondary px-6 text-center">
        Task not found or you don't have access.
      </div>
    );
  }

  const subitems = (itemsData?.items ?? [])
    .filter((i) => i.parent_item_id === item.id && !i.archived_at)
    .sort((a, b) => a.sort_order - b.sort_order);

  const commitRename = async () => {
    setRenaming(false);
    const t = draftName.trim();
    if (!t || t === item.name) { setDraftName(item.name); return; }
    try {
      await rename.mutateAsync({ id: item.id, name: t, boardId: board.id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rename failed');
      setDraftName(item.name);
    }
  };

  const startRename = () => {
    setDraftName(item.name);
    setRenaming(true);
  };

  // Reload items list when posting updates (so updated_at reflects in board)
  const onAfterMutate = () => void qc.invalidateQueries({ queryKey: ['items', 'board', board.id] });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header
        className={cn(
          'flex items-center gap-2 px-4 py-3 border-b border-border-light bg-surface shrink-0',
          variant === 'panel' && 'shadow-sm',
        )}
      >
        {variant === 'panel' && onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="h-7 w-7 inline-flex items-center justify-center rounded-sm text-text-secondary hover:bg-hover shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-text-secondary flex items-center gap-1 truncate">
            <Link to="/" className="hover:underline">Main workspace</Link>
            <ChevronRight className="h-3 w-3" />
            <Link
              to="/w/$workspace/b/$boardId"
              params={{ workspace: 'main', boardId: board.id }}
              className="hover:underline truncate"
            >
              {board.icon_emoji} {board.name}
            </Link>
          </p>
          <div className="flex items-center gap-2">
            {renaming && canEdit ? (
              <input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={() => void commitRename()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commitRename();
                  else if (e.key === 'Escape') { setDraftName(item.name); setRenaming(false); }
                }}
                className="flex-1 text-xl font-semibold leading-tight bg-surface border border-brand rounded-sm px-1 outline-none"
              />
            ) : (
              <h2
                onClick={() => canEdit && startRename()}
                className={cn('flex-1 text-xl font-semibold leading-tight truncate', canEdit && 'cursor-text hover:bg-hover px-1 -mx-1 rounded-sm')}
              >
                {item.name}
              </h2>
            )}
            <span className="text-[11px] font-mono text-text-disabled shrink-0">{item.task_code}</span>
          </div>
        </div>
        {variant === 'panel' && fullPageHref && (
          <Link
            to={fullPageHref}
            aria-label="Open full page"
            title="Open full page"
            className="h-7 w-7 inline-flex items-center justify-center rounded-sm text-text-secondary hover:bg-hover shrink-0"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Link>
        )}
        <button
          type="button"
          aria-label="More"
          disabled
          className="h-7 w-7 inline-flex items-center justify-center rounded-sm text-text-disabled shrink-0"
          title="Task menu — Phase 5"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </header>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        {/* Fields */}
        <section className="border-b border-border-light bg-app/40">
          <TaskFieldsZone
            item={item}
            columns={columns ?? []}
            labelsByColumnId={labelsByColumnId ?? new Map()}
            valuesByItemColumn={itemsData?.valuesByItemColumn ?? new Map()}
            boardId={board.id}
            canEdit={canEdit}
            onOpenLabelsEditor={setLabelsForColumn}
          />
        </section>

        {/* Subitems (only on top-level items) */}
        {!item.parent_item_id && (
          <SubitemsSection
            parent={item}
            subitems={subitems as ItemRow[]}
            canEdit={canEdit}
            onOpenSubitem={(id) => onOpenItem?.(id)}
          />
        )}

        {/* Tabs */}
        <div className="px-2 pt-2 border-b border-border-light flex items-center gap-1 sticky top-0 bg-surface z-[1]">
          <TabBtn active={tab === 'updates'}  onClick={() => setTab('updates')}  icon={<MessageSquare className="h-3.5 w-3.5" />} label="Updates" />
          <TabBtn active={tab === 'files'}    onClick={() => setTab('files')}    icon={<Paperclip className="h-3.5 w-3.5" />}     label="Files" />
          <TabBtn active={tab === 'activity'} onClick={() => setTab('activity')} icon={<Clock className="h-3.5 w-3.5" />}         label="Activity" />
        </div>

        <div className="p-4">
          {tab === 'updates'  && <UpdatesTab itemId={item.id} canEdit={canEdit} />}
          {tab === 'files'    && <FilesTab boardId={board.id} itemId={item.id} canEdit={canEdit} />}
          {tab === 'activity' && <ActivityTab itemId={item.id} boardId={board.id} />}
        </div>
      </div>

      {/* Labels modal (shared) */}
      {labelsForColumn && (
        <LabelsEditorModal
          open
          onClose={() => { setLabelsForColumn(null); onAfterMutate(); }}
          boardId={board.id}
          column={labelsForColumn}
        />
      )}
    </div>
  );
}

function TabBtn({ active, icon, label, onClick }: {
  active: boolean; icon: React.ReactNode; label: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-8 px-3 -mb-px text-xs font-medium flex items-center gap-1.5 border-b-2 transition-colors duration-100',
        active ? 'border-brand text-brand' : 'border-transparent text-text-secondary hover:text-text-primary',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
