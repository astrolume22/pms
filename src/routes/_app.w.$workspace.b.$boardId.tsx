import { useEffect } from 'react';
import { createFileRoute, useParams } from '@tanstack/react-router';
import { Lock, FileQuestion, ArchiveRestore, Archive } from 'lucide-react';
import { toast } from 'sonner';
import { useBoard, useRestoreBoard, useUpdateLastViewed } from '@/hooks/boards';
import { useAuthStore } from '@/state/authStore';
import { Spinner } from '@/components/Spinner';
import { EmptyMessage } from '@/components/EmptyMessage';
import { BoardHeader } from '@/components/board/BoardHeader';
import { BoardTabs } from '@/components/board/BoardTabs';
import { BoardToolbar } from '@/components/board/BoardToolbar';
import { BoardContent } from '@/components/board/BoardContent';

export const Route = createFileRoute('/_app/w/$workspace/b/$boardId')({
  component: BoardPage,
});

function BoardPage() {
  const { boardId } = useParams({ from: '/_app/w/$workspace/b/$boardId' });
  const profile = useAuthStore((s) => s.profile);
  const { data: board, isLoading, error } = useBoard(boardId);
  const updateLastViewed = useUpdateLastViewed();
  const restore = useRestoreBoard();

  // Bump "last viewed" once per mount per board.
  useEffect(() => {
    if (board && profile) {
      void updateLastViewed.mutateAsync(board.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board?.id, profile?.id]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner className="h-6 w-6 text-brand" />
      </div>
    );
  }

  // Distinguish "doesn't exist" from "forbidden" by examining the error code.
  // RLS-blocked boards return null with no error (PostgREST hides them),
  // so we treat null + access denied identically. We can refine in V2 once
  // we surface a separate admin-only "exists check" RPC.
  if (error) {
    return (
      <EmptyMessage
        title="Couldn't load board"
        description={error instanceof Error ? error.message : 'Unknown error'}
        icon={<FileQuestion className="h-7 w-7" />}
      />
    );
  }

  if (!board) {
    // Either truly nonexistent or RLS-hidden. Show 404 to non-admins, 403 hint to admins.
    const isAdmin = profile?.role === 'admin' || profile?.is_super_admin;
    if (isAdmin) {
      return (
        <EmptyMessage
          title="Board not found"
          description={`No board exists with ID ${boardId}.`}
          icon={<FileQuestion className="h-7 w-7" />}
          action={{ label: 'Back to workspace home', to: '/' }}
        />
      );
    }
    return (
      <EmptyMessage
        title="You don't have access to this board"
        description="If you think that's a mistake, ask the board owner or an admin to invite you."
        icon={<Lock className="h-7 w-7" />}
        action={{ label: 'Back to workspace home', to: '/' }}
      />
    );
  }

  const canManage =
    profile && (profile.role === 'admin' || profile.is_super_admin || board.owner_id === profile.id);

  return (
    <div className="flex flex-col">
      {board.archived_at && (
        <div className="px-8 py-2 bg-warning/10 text-warning text-sm flex items-center gap-3 border-b border-warning/20">
          <Archive className="h-4 w-4" />
          <span className="flex-1">This board is archived. It's hidden from sidebar lists.</span>
          {canManage && (
            <button
              type="button"
              onClick={async () => {
                try {
                  await restore.mutateAsync(board.id);
                  toast.success('Board restored');
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Restore failed');
                }
              }}
              className="btn-secondary h-7 px-2 text-xs inline-flex items-center gap-1"
            >
              <ArchiveRestore className="h-3.5 w-3.5" />
              Restore
            </button>
          )}
        </div>
      )}
      <BoardHeader board={board} />
      <BoardTabs />
      <BoardToolbar boardId={board.id} canEdit={!!canManage || profile?.role === 'manager'} />
      <BoardContent board={board} />
    </div>
  );
}
