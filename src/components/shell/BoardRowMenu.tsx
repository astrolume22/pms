import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { MoreHorizontal, Star, Pencil, Archive, Trash2, Link as LinkIcon, Smile, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import {
  useArchiveBoard,
  useDeleteBoard,
  useToggleFavorite,
  type BoardListItem,
} from '@/hooks/boards';
import { useDuplicateBoard } from '@/hooks/duplicate';
import { useAuthStore } from '@/state/authStore';

interface BoardRowMenuProps {
  board: BoardListItem;
  onRename: () => void;
  onChangeIcon: () => void;
}

export function BoardRowMenu({ board, onRename, onChangeIcon }: BoardRowMenuProps) {
  const profile = useAuthStore((s) => s.profile);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const toggleFav = useToggleFavorite();
  const archive = useArchiveBoard();
  const remove = useDeleteBoard();
  const duplicate = useDuplicateBoard();
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (!profile) return null;

  // Per docs/PERMISSIONS-REDESIGN-PLAN.md: only admins manage boards.
  const isAdmin = profile.role === 'admin' || profile.is_super_admin;
  if (!isAdmin) return null;
  const canManage = isAdmin;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label="Board options"
        className="h-6 w-6 inline-flex items-center justify-center rounded-sm text-text-secondary hover:bg-hover opacity-0 group-hover/board:opacity-100 focus-visible:opacity-100 data-[open=true]:opacity-100"
        data-open={open || undefined}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-7 w-56 z-40 bg-surface border border-border-light rounded-md shadow-lg overflow-hidden"
        >
          <Item
            icon={<Star className={cn('h-4 w-4', board.is_favorite && 'fill-warning text-warning')} />}
            label={board.is_favorite ? 'Unfavorite' : 'Add to favorites'}
            onClick={async () => {
              setOpen(false);
              await toggleFav.mutateAsync({ boardId: board.id, makeFavorite: !board.is_favorite });
            }}
          />
          <Item
            icon={<Pencil className="h-4 w-4" />}
            label="Rename"
            disabled={!canManage}
            onClick={() => {
              setOpen(false);
              onRename();
            }}
          />
          <Item
            icon={<Smile className="h-4 w-4" />}
            label="Change icon"
            disabled={!canManage}
            onClick={() => {
              setOpen(false);
              onChangeIcon();
            }}
          />
          <Item
            icon={<LinkIcon className="h-4 w-4" />}
            label="Copy link"
            onClick={async () => {
              setOpen(false);
              const url = `${window.location.origin}/w/main/b/${board.id}`;
              try {
                await navigator.clipboard.writeText(url);
                toast.success('Link copied');
              } catch {
                toast.error('Could not copy link');
              }
            }}
          />
          <Item
            icon={<Copy className="h-4 w-4" />}
            label="Duplicate board"
            disabled={!canManage || duplicate.isPending}
            onClick={async () => {
              setOpen(false);
              try {
                const newId = await duplicate.mutateAsync(board.id);
                toast.success('Board duplicated');
                // Jump to the new copy so the user sees the result
                // immediately (same UX as the BoardHeader path).
                navigate({
                  to: '/w/$workspace/b/$boardId',
                  params: { workspace: 'main', boardId: newId },
                });
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Duplicate failed');
              }
            }}
          />
          <div className="h-px bg-border-light my-1" />
          <Item
            icon={<Archive className="h-4 w-4" />}
            label="Archive"
            disabled={!canManage}
            onClick={async () => {
              setOpen(false);
              try {
                await archive.mutateAsync(board.id);
                toast.success('Board archived');
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Archive failed');
              }
            }}
          />
          <Item
            icon={<Trash2 className="h-4 w-4 text-error" />}
            label="Delete"
            disabled={!canManage}
            destructive
            onClick={async () => {
              setOpen(false);
              if (!window.confirm(`Delete "${board.name}"? Can be restored from admin trash.`)) return;
              try {
                await remove.mutateAsync(board.id);
                toast.success('Board deleted');
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Delete failed');
              }
            }}
          />
        </div>
      )}
    </div>
  );
}

function Item({
  icon,
  label,
  onClick,
  disabled,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'w-full text-left px-3 py-1.5 text-sm flex items-center gap-2',
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
