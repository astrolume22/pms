import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useNavigate } from '@tanstack/react-router';
import { Home, ChevronDown, Star, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { WorkspaceRow } from '@/lib/database.types';
import { useBoards, useUpdateBoard, type BoardListItem } from '@/hooks/boards';
import { useAuthStore } from '@/state/authStore';
import { CreateBoardModal } from '@/components/CreateBoardModal';
import { EmojiPicker } from '@/components/EmojiPicker';
import { BoardRowMenu } from './BoardRowMenu';
import { AddNewMenu } from './AddNewMenu';
import { cn } from '@/lib/cn';
import { toast } from 'sonner';

export function WorkspacePanel() {
  const profile = useAuthStore((s) => s.profile);
  const [createOpen, setCreateOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [iconEditingId, setIconEditingId] = useState<string | null>(null);

  // Per docs/PERMISSIONS-REDESIGN-PLAN.md: only admins create boards.
  const canCreate = !!profile && (profile.role === 'admin' || profile.is_super_admin);

  const { data: workspace } = useQuery({
    queryKey: ['workspace', 'main'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workspaces')
        .select('*')
        .eq('is_main', true)
        .maybeSingle();
      if (error) throw error;
      return (data as WorkspaceRow | null) ?? null;
    },
  });

  const { data: boards, isLoading } = useBoards();

  const favorites = (boards ?? []).filter((b) => b.is_favorite);
  const allBoards = (boards ?? []).filter((b) => !b.archived_at);

  return (
    <aside className="w-60 shrink-0 border-r border-border-light bg-sidebar flex flex-col">
      {/* Workspace switcher */}
      <div className="p-3 border-b border-border-light">
        <button
          type="button"
          className="w-full flex items-center gap-2 px-2 py-2 rounded-base hover:bg-hover transition-colors duration-100 text-left"
        >
          <span
            className="h-6 w-6 inline-flex items-center justify-center rounded-base text-white text-xs font-medium"
            style={{ background: workspace?.icon_color ?? '#0073EA' }}
          >
            {workspace?.icon_emoji ?? '🏠'}
          </span>
          <span className="text-sm font-medium flex-1 truncate">
            {workspace?.name ?? 'Main workspace'}
          </span>
          <ChevronDown className="h-4 w-4 text-text-secondary" />
        </button>
      </div>

      {/* Navigation */}
      <div className="px-2 py-2 flex-1 overflow-y-auto">
        <Link
          to="/"
          className="flex items-center gap-2 px-2 py-1.5 rounded-base text-sm hover:bg-hover transition-colors duration-100"
          activeOptions={{ exact: true }}
          activeProps={{ className: 'bg-selected text-brand font-medium' }}
        >
          <Home className="h-4 w-4" />
          <span>Workspace home</span>
        </Link>

        {/* Favorites */}
        {favorites.length > 0 && (
          <div className="mt-4">
            <SectionLabel>Favorites</SectionLabel>
            <ul>
              {favorites.map((b) => (
                <BoardRow
                  key={b.id}
                  board={b}
                  isRenaming={renamingId === b.id}
                  isEditingIcon={iconEditingId === b.id}
                  onStartRename={() => setRenamingId(b.id)}
                  onEndRename={() => setRenamingId(null)}
                  onStartIcon={() => setIconEditingId(b.id)}
                  onEndIcon={() => setIconEditingId(null)}
                  starFilled
                />
              ))}
            </ul>
          </div>
        )}

        {/* All boards */}
        <div className="mt-4">
          <SectionLabel>Boards</SectionLabel>
          {isLoading ? (
            <div className="px-2 py-2 flex items-center gap-2 text-text-secondary text-xs">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading…
            </div>
          ) : allBoards.length === 0 ? (
            <p className="px-2 py-1 text-xs text-text-disabled">No boards yet</p>
          ) : (
            <ul>
              {allBoards.map((b) => (
                <BoardRow
                  key={b.id}
                  board={b}
                  isRenaming={renamingId === b.id}
                  isEditingIcon={iconEditingId === b.id}
                  onStartRename={() => setRenamingId(b.id)}
                  onEndRename={() => setRenamingId(null)}
                  onStartIcon={() => setIconEditingId(b.id)}
                  onEndIcon={() => setIconEditingId(null)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Add new — admin only. Managers see a clean sidebar with just
          their assigned boards. */}
      {canCreate && (
        <div className="p-3 border-t border-border-light">
          <AddNewMenu canCreate={canCreate} onCreateBoard={() => setCreateOpen(true)} />
        </div>
      )}

      <CreateBoardModal open={createOpen} onClose={() => setCreateOpen(false)} />

      {iconEditingId && (() => {
        const b = (boards ?? []).find((x) => x.id === iconEditingId);
        if (!b) return null;
        return (
          <IconEditorPopover
            board={b}
            onClose={() => setIconEditingId(null)}
          />
        );
      })()}
    </aside>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center px-2 mb-1 mt-1">
      {/* Tessera "BOARDS" heading — dim, small, wider tracking. */}
      <span
        className="text-[11px] uppercase font-semibold text-text-disabled"
        style={{ letterSpacing: '0.08em' }}
      >
        {children}
      </span>
    </div>
  );
}

interface BoardRowProps {
  board: BoardListItem;
  isRenaming: boolean;
  isEditingIcon: boolean;
  onStartRename: () => void;
  onEndRename: () => void;
  onStartIcon: () => void;
  onEndIcon: () => void;
  starFilled?: boolean;
}

function BoardRow({
  board,
  isRenaming,
  onStartRename,
  onEndRename,
  onStartIcon,
  starFilled,
}: BoardRowProps) {
  const params = useParams({ strict: false }) as { boardId?: string };
  const isActive = params.boardId === board.id;
  const update = useUpdateBoard();
  const [name, setName] = useState(board.name);

  const commit = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === board.name) {
      onEndRename();
      setName(board.name);
      return;
    }
    try {
      await update.mutateAsync({ id: board.id, patch: { name: trimmed } });
      toast.success('Board renamed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rename failed');
      setName(board.name);
    } finally {
      onEndRename();
    }
  };

  return (
    <li className="group/board">
      <div
        className={cn(
          // Tessera-style row: 32px tall, 13/500. Active row sits on
          // the elevated surface (#292F4C) with a 3px brand-blue left
          // accent — `pl-[5px]` keeps the inner gap honest after the
          // border eats 3px from the left.
          'flex items-center gap-2 h-8 pl-2 pr-2 rounded-base text-[13px] font-medium transition-colors duration-100',
          'hover:bg-hover',
          isActive
            ? 'bg-elevated text-text-primary border-l-[3px] border-brand pl-[5px]'
            : 'text-text-secondary',
        )}
      >
        <Link
          to="/w/$workspace/b/$boardId"
          params={{ workspace: 'main', boardId: board.id }}
          className="flex items-center gap-2 flex-1 min-w-0"
          onClick={(e) => {
            // Don't navigate if currently renaming (form takes priority).
            if (isRenaming) e.preventDefault();
          }}
        >
          <span className="text-base shrink-0">{board.icon_emoji}</span>
          {isRenaming ? (
            <input
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void commit()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commit();
                else if (e.key === 'Escape') {
                  setName(board.name);
                  onEndRename();
                }
              }}
              className="flex-1 min-w-0 bg-transparent border border-brand rounded-sm px-1 outline-none"
              onClick={(e) => e.preventDefault()}
            />
          ) : (
            <span className="truncate">{board.name}</span>
          )}
        </Link>
        {starFilled && <Star className="h-3.5 w-3.5 fill-warning text-warning shrink-0" />}
        <BoardRowMenu board={board} onRename={onStartRename} onChangeIcon={onStartIcon} />
      </div>
    </li>
  );
}

function IconEditorPopover({ board, onClose }: { board: BoardListItem; onClose: () => void }) {
  const update = useUpdateBoard();
  const navigate = useNavigate();

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-border-light rounded-md shadow-xl p-4 w-[300px]"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-medium mb-2">Change icon for {board.name}</p>
        <EmojiPicker
          value={board.icon_emoji}
          onChange={async (emoji) => {
            try {
              await update.mutateAsync({ id: board.id, patch: { icon_emoji: emoji } });
              toast.success('Icon updated');
              onClose();
              // Trigger sidebar/header refresh through query cache (mutation already does it).
              navigate({ to: window.location.pathname });
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Update failed');
            }
          }}
        />
        <div className="flex justify-end mt-3">
          <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
