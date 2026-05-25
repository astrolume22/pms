import { Suspense, lazy, useEffect, useState } from 'react';
import { Star, UserPlus, MoreHorizontal, Archive, ArchiveRestore, Trash2, Lock, Globe, Sparkles, Copy, FileText } from 'lucide-react';
import { useDuplicateBoard } from '@/hooks/duplicate';

// InviteModal is only used by admins / owners / managers — defer.
const InviteModal = lazy(() => import('@/components/board/InviteModal').then((m) => ({ default: m.InviteModal })));
// "Build with AI" (Version B) — admin-only. The modal pulls in the
// applier + Zod-validated AI plan rendering, so defer until needed.
const BuildWithAiModal = lazy(() => import('@/components/board/BuildWithAiModal').then((m) => ({ default: m.BuildWithAiModal })));
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
  const [buildOpen, setBuildOpen] = useState(false);
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

  // Description is hidden by default per the polish spec — expanded
  // inline when the user clicks the small icon next to the title (or
  // when there's existing content to display).
  const [descOpen, setDescOpen] = useState<boolean>(false);
  const hasDesc = Boolean(board.description && board.description.trim().length > 0);

  // Created / Updated dates surface in the title tooltip — no longer
  // their own row.
  const titleTooltip = [
    `Created ${new Date(board.created_at).toLocaleDateString()}`,
    `Updated ${new Date(board.updated_at).toLocaleDateString()}`,
  ].join(' · ');

  return (
    <div className="px-8 pt-3 pb-2 bg-canvas">
      {/* Row 1 — title row. Emoji + title + badge + actions on a single
          line. Description + dates collapsed by default. */}
      <div className="flex items-center gap-3">
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
          <div className="h-9 w-9 inline-flex items-center justify-center text-2xl">
            {board.icon_emoji}
          </div>
        )}

        <div className="flex-1 min-w-0 flex items-center gap-2">
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
              className="text-title bg-transparent border-b border-chip-sky px-1 outline-none max-w-[600px]"
            />
          ) : (
            <h1
              onClick={() => canEdit && setEditingName(true)}
              title={titleTooltip}
              // Tessera spec: 22px / 700 plain white. Bump from the
              // shared .text-title (600) to font-bold for the topbar
              // title only, then truncate as before.
              className={cn('text-title font-bold truncate', canEdit && 'cursor-text hover:bg-[var(--overlay-6)] px-1 -mx-1 rounded-button')}
            >
              {board.name}
            </h1>
          )}
          <BoardTypeBadge type={board.board_type} />
          {/* Description toggle — hidden behind a small icon. Pressing it
              expands an inline textarea below; if the board already has a
              description, clicking the icon opens it directly. */}
          {canEdit && (
            <button
              type="button"
              onClick={() => {
                if (hasDesc) setEditingDesc((v) => !v);
                else setDescOpen((v) => !v);
              }}
              title={hasDesc ? 'Edit description' : 'Add description'}
              aria-label={hasDesc ? 'Edit description' : 'Add description'}
              className="h-7 w-7 inline-flex items-center justify-center rounded-button text-text-secondary hover:bg-[var(--overlay-8)] hover:text-text-primary transition-colors duration-100"
            >
              <FileText className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Right actions — sit on the same row as the title now. */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Favorite + Build with AI + Invite + overflow. All
              admin-only — managers consume the board read-only. */}
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
              className="h-8 w-8 inline-flex items-center justify-center rounded-button text-text-secondary hover:bg-[var(--overlay-8)] hover:text-text-primary transition-colors duration-100"
              title={board.is_favorite ? 'Unfavorite' : 'Add to favorites'}
            >
              <Star
                className={cn('h-4 w-4', board.is_favorite && 'fill-current')}
                style={board.is_favorite ? { color: 'var(--chip-amber)' } : undefined}
              />
            </button>
          )}
          {/* Build with AI — admin only. The ONLY place gradients are
              allowed on the board per the polish spec. Subtle sheen
              over a chip-sky base reads as "premium AI" without going
              neon. */}
          {isAdmin && (
            <button
              type="button"
              onClick={() => setBuildOpen(true)}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-button text-[13px] font-medium text-white hover:brightness-110 transition-[filter] duration-100"
              style={{
                background: 'linear-gradient(135deg, var(--chip-sky) 0%, var(--chip-purple) 100%)',
                letterSpacing: '0.02em',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18)',
              }}
              title="Build groups + columns + tasks from a prompt"
            >
              <Sparkles className="h-4 w-4" />
              Build with AI
            </button>
          )}
          {/* Invite — admin only (RLS will also block managers if they
              somehow trigger create_invite via the network). Same sky
              fill as New task / Build with AI. */}
          {isAdmin && (
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-button text-[13px] font-medium text-white hover:brightness-110 transition-[filter] duration-100"
              style={{ background: 'var(--chip-sky)', letterSpacing: '0.02em' }}
              title="Invite teammates with a shareable link"
            >
              <UserPlus className="h-4 w-4" />
              Invite
            </button>
          )}
          {isAdmin && (
          <div className="relative">
            <button
              type="button"
              aria-label="More"
              onClick={() => setMenuOpen((v) => !v)}
              className="h-8 w-8 inline-flex items-center justify-center rounded-button text-text-secondary hover:bg-[var(--overlay-8)] hover:text-text-primary transition-colors duration-100"
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

      {/* Inline description — collapsed by default. Expanded when the
          user clicks the description toggle, or shown read-only when a
          description already exists. Stays a single visual row of
          chrome so the "two rows max" rule holds. */}
      {(editingDesc || descOpen || hasDesc) && (
        <div className="mt-2 ml-12 max-w-[800px]">
          {editingDesc && canEdit ? (
            <textarea
              autoFocus
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => { void commitDesc(); setDescOpen(false); }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setDescription(board.description ?? '');
                  setEditingDesc(false);
                  setDescOpen(false);
                }
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void commitDesc();
              }}
              className="w-full text-[13px] text-text-primary bg-transparent border-b border-chip-sky px-1 py-1 outline-none resize-y"
              rows={2}
              placeholder="Add description…"
            />
          ) : hasDesc ? (
            <p
              onClick={() => canEdit && setEditingDesc(true)}
              className={cn(
                'text-[13px] text-text-secondary truncate',
                canEdit && 'cursor-text hover:bg-[var(--overlay-6)] px-1 -mx-1 rounded-button',
              )}
              title={board.description ?? ''}
            >
              {board.description}
            </p>
          ) : descOpen && canEdit ? (
            <button
              type="button"
              onClick={() => setEditingDesc(true)}
              className="text-[13px] text-text-secondary italic px-1 -mx-1 rounded-button hover:bg-[var(--overlay-6)]"
            >
              Add description…
            </button>
          ) : null}
        </div>
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
      {buildOpen && (
        <Suspense fallback={null}>
          <BuildWithAiModal
            open={buildOpen}
            onClose={() => setBuildOpen(false)}
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
      <span className="inline-flex items-center gap-1 h-5 px-2 rounded-pill text-[13px] font-medium bg-label-purple/15 text-label-purple">
        <Lock className="h-3 w-3" />
        Private
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 h-5 px-2 rounded-pill text-[13px] font-medium bg-brand/15 text-brand">
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
