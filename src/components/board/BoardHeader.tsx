import { Suspense, lazy, useEffect, useState } from 'react';
import { ChevronDown, Star, UserPlus, MoreHorizontal, Archive, ArchiveRestore, Trash2, Lock, Globe, Sparkles, Copy } from 'lucide-react';
import { useDuplicateBoard } from '@/hooks/duplicate';

// AiPanel pulls in markdown parsing + the Gemini chat machinery — only
// load it the first time the user opens the AI Sidekick.
const AiPanel     = lazy(() => import('@/components/ai/AiPanel').then((m)     => ({ default: m.AiPanel })));
// InviteModal is only used by admins / owners / managers — defer.
const InviteModal = lazy(() => import('@/components/board/InviteModal').then((m) => ({ default: m.InviteModal })));
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import { EmojiPicker } from '@/components/EmojiPicker';
import {
  useArchiveBoard,
  useDeleteBoard,
  useRestoreBoard,
  useToggleFavorite,
  useUpdateBoard,
  type BoardWithOwner,
} from '@/hooks/boards';
import { useAuthStore } from '@/state/authStore';
import { useNavigate } from '@tanstack/react-router';

interface BoardHeaderProps {
  board: BoardWithOwner;
}

export function BoardHeader({ board }: BoardHeaderProps) {
  const profile = useAuthStore((s) => s.profile);
  const navigate = useNavigate();

  // New permission model: admin-only writes. The legacy "board owner can
  // edit" branch is retired (per docs/PERMISSIONS-REDESIGN-PLAN.md).
  const isAdmin = !!profile && (profile.role === 'admin' || profile.is_super_admin);
  const canEdit = isAdmin;
  const canManage = isAdmin;

  const update = useUpdateBoard();
  const duplicate = useDuplicateBoard();
  const toggleFav = useToggleFavorite();
  const archive = useArchiveBoard();
  const restore = useRestoreBoard();
  const del = useDeleteBoard();

  const [name, setName] = useState(board.name);
  const [editingName, setEditingName] = useState(false);
  const [description, setDescription] = useState(board.description ?? '');
  const [editingDesc, setEditingDesc] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  useEffect(() => setName(board.name), [board.name]);
  useEffect(() => setDescription(board.description ?? ''), [board.description]);

  const commitName = async () => {
    setEditingName(false);
    const trimmed = name.trim();
    if (!trimmed || trimmed === board.name) {
      setName(board.name);
      return;
    }
    try {
      await update.mutateAsync({ id: board.id, patch: { name: trimmed } });
      toast.success('Board renamed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rename failed');
      setName(board.name);
    }
  };

  const commitDesc = async () => {
    setEditingDesc(false);
    if ((description ?? '') === (board.description ?? '')) return;
    try {
      await update.mutateAsync({ id: board.id, patch: { description: description.trim() || null } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Description update failed');
    }
  };

  return (
    <div className="px-8 pt-6 pb-3 border-b border-border-light bg-surface">
      <div className="flex items-start gap-3">
        {canEdit ? (
          <EmojiPicker
            value={board.icon_emoji}
            onChange={async (emoji) => {
              try {
                await update.mutateAsync({ id: board.id, patch: { icon_emoji: emoji } });
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Icon update failed');
              }
            }}
          />
        ) : (
          <div className="h-10 w-10 inline-flex items-center justify-center text-2xl">
            {board.icon_emoji}
          </div>
        )}

        <div className="flex-1 min-w-0">
          {/* Name (inline editable) */}
          <div className="flex items-center gap-2">
            {editingName && canEdit ? (
              <input
                type="text"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => void commitName()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commitName();
                  else if (e.key === 'Escape') {
                    setName(board.name);
                    setEditingName(false);
                  }
                }}
                className="text-3xl font-bold bg-transparent border border-brand rounded-sm px-1 outline-none w-full max-w-[600px]"
              />
            ) : (
              <h1
                onClick={() => canEdit && setEditingName(true)}
                className={cn('text-3xl font-bold leading-tight', canEdit && 'cursor-text hover:bg-hover px-1 -mx-1 rounded-sm')}
              >
                {board.name}
              </h1>
            )}
            <button
              type="button"
              aria-label="Board info"
              className="h-8 w-8 inline-flex items-center justify-center rounded-base text-text-secondary hover:bg-hover"
              disabled
              title="Board info — Phase 5"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
            <BoardTypeBadge type={board.board_type} />
          </div>

          {/* Description (inline editable) */}
          <div className="mt-1">
            {editingDesc && canEdit ? (
              <textarea
                autoFocus
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={() => void commitDesc()}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setDescription(board.description ?? '');
                    setEditingDesc(false);
                  }
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void commitDesc();
                }}
                className="w-full max-w-[800px] text-sm text-text-primary bg-transparent border border-brand rounded-sm px-2 py-1 outline-none resize-y"
                rows={2}
                placeholder="Add description..."
              />
            ) : (
              <p
                onClick={() => canEdit && setEditingDesc(true)}
                className={cn(
                  'text-sm max-w-[800px]',
                  description ? 'text-text-secondary' : 'text-text-disabled italic',
                  canEdit && 'cursor-text hover:bg-hover px-2 -mx-2 py-1 rounded-sm',
                )}
              >
                {description || 'Add description...'}
              </p>
            )}
          </div>

          {/* Meta strip — Owner intentionally hidden globally per
              docs/PERMISSIONS-REDESIGN-PLAN.md (admin → manager model has no
              per-board owner concept in the UI; the data stays in DB). */}
          <div className="mt-2 flex items-center gap-3 text-xs text-text-secondary">
            <span>Created {new Date(board.created_at).toLocaleDateString()}</span>
            <span>Updated {new Date(board.updated_at).toLocaleDateString()}</span>
          </div>
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setAiOpen(true)}
            className="h-8 px-2.5 inline-flex items-center gap-1.5 rounded-base text-sm font-medium text-brand hover:bg-brand/10"
            title="AI Sidekick"
            aria-label="Open AI Sidekick"
          >
            <Sparkles className="h-4 w-4" />
            <span>AI</span>
          </button>
          {/* Favorite + ⋯ menu (archive/delete) are admin-only. Managers
              just consume the board read-only; they don't curate it. */}
          {isAdmin && (
            <button
              type="button"
              aria-label={board.is_favorite ? 'Unfavorite' : 'Favorite'}
              onClick={async () => {
                try {
                  await toggleFav.mutateAsync({ boardId: board.id, makeFavorite: !board.is_favorite });
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Could not update favorite');
                }
              }}
              className="h-8 w-8 inline-flex items-center justify-center rounded-base text-text-secondary hover:bg-hover"
              title={board.is_favorite ? 'Unfavorite' : 'Add to favorites'}
            >
              <Star className={cn('h-4 w-4', board.is_favorite && 'fill-warning text-warning')} />
            </button>
          )}
          {/* Invite — admin only (RLS will also block managers if they
              somehow trigger create_invite via the network). */}
          {isAdmin && (
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              className="btn-secondary h-8 px-3"
              title="Invite teammates with a shareable link"
            >
              <UserPlus className="h-4 w-4 mr-1" />
              Invite
            </button>
          )}
          {isAdmin && (
          <div className="relative">
            <button
              type="button"
              aria-label="More"
              onClick={() => setMenuOpen((v) => !v)}
              className="h-8 w-8 inline-flex items-center justify-center rounded-base text-text-secondary hover:bg-hover"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-9 w-56 z-30 bg-surface border border-border-light rounded-md shadow-lg overflow-hidden"
                onMouseLeave={() => setMenuOpen(false)}
              >
                <MenuItem
                  icon={<Copy className="h-4 w-4" />}
                  label="Duplicate board"
                  disabled={!canManage || duplicate.isPending}
                  onClick={async () => {
                    setMenuOpen(false);
                    try {
                      const newId = await duplicate.mutateAsync(board.id);
                      toast.success('Board duplicated');
                      navigate({
                        to: '/w/$workspace/b/$boardId',
                        params: { workspace: 'main', boardId: newId },
                      });
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'Duplicate failed');
                    }
                  }}
                />
                {board.archived_at ? (
                  <MenuItem
                    icon={<ArchiveRestore className="h-4 w-4" />}
                    label="Restore board"
                    disabled={!canManage}
                    onClick={async () => {
                      setMenuOpen(false);
                      try {
                        await restore.mutateAsync(board.id);
                        toast.success('Board restored');
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : 'Restore failed');
                      }
                    }}
                  />
                ) : (
                  <MenuItem
                    icon={<Archive className="h-4 w-4" />}
                    label="Archive board"
                    disabled={!canManage}
                    onClick={async () => {
                      setMenuOpen(false);
                      try {
                        await archive.mutateAsync(board.id);
                        toast.success('Board archived');
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : 'Archive failed');
                      }
                    }}
                  />
                )}
                <MenuItem
                  icon={<Trash2 className="h-4 w-4 text-error" />}
                  label="Delete board"
                  disabled={!canManage}
                  destructive
                  onClick={async () => {
                    setMenuOpen(false);
                    if (!window.confirm(`Delete "${board.name}"?`)) return;
                    try {
                      await del.mutateAsync(board.id);
                      toast.success('Board deleted');
                      navigate({ to: '/' });
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'Delete failed');
                    }
                  }}
                />
              </div>
            )}
          </div>
          )}
        </div>
      </div>
      {aiOpen && (
        <Suspense fallback={null}>
          <AiPanel open={aiOpen} onClose={() => setAiOpen(false)} board={board} />
        </Suspense>
      )}
      {inviteOpen && (
        <Suspense fallback={null}>
          <InviteModal
            open={inviteOpen}
            onClose={() => setInviteOpen(false)}
            boardId={board.id}
            boardName={board.name}
          />
        </Suspense>
      )}
    </div>
  );
}

function BoardTypeBadge({ type }: { type: 'main' | 'private' }) {
  if (type === 'private') {
    return (
      <span className="inline-flex items-center gap-1 h-5 px-2 rounded-pill text-xs font-medium bg-label-purple/15 text-label-purple">
        <Lock className="h-3 w-3" />
        Private
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 h-5 px-2 rounded-pill text-xs font-medium bg-brand/15 text-brand">
      <Globe className="h-3 w-3" />
      Main
    </span>
  );
}

function MenuItem({
  icon, label, onClick, disabled, destructive,
}: {
  icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; destructive?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'w-full text-left px-3 py-2 text-sm flex items-center gap-2',
        'hover:bg-hover disabled:opacity-40 disabled:cursor-not-allowed',
        destructive && 'text-error',
      )}
      role="menuitem"
    >
      <span className="text-text-secondary">{icon}</span>
      <span>{label}</span>
    </button>
  );
}
