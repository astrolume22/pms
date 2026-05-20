import { useEffect } from 'react';
import { createFileRoute, useNavigate, useParams } from '@tanstack/react-router';
import { Lock, FileQuestion, ArchiveRestore, Archive } from 'lucide-react';
import { toast } from 'sonner';
import { useBoard, useRestoreBoard, useUpdateLastViewed } from '@/hooks/boards';
import { useAuthStore } from '@/state/authStore';
import { useViews } from '@/hooks/views';
import { Spinner } from '@/components/Spinner';
import { EmptyMessage } from '@/components/EmptyMessage';
import { BoardHeader } from '@/components/board/BoardHeader';
import { BoardTabs } from '@/components/board/BoardTabs';
import { BoardToolbar } from '@/components/board/BoardToolbar';
import { BoardContent } from '@/components/board/BoardContent';
import { KanbanView } from '@/components/board/views/KanbanView';
import { CalendarView } from '@/components/board/views/CalendarView';
import { TaskPanel } from '@/components/task/TaskPanel';

interface BoardSearch {
  p?: string;       // ?p=<itemId> opens the slide-in task panel
  v?: string;       // ?v=<viewId> switches to a non-default view
}

export const Route = createFileRoute('/_app/w/$workspace/b/$boardId')({
  validateSearch: (search: Record<string, unknown>): BoardSearch => ({
    p: typeof search.p === 'string' ? search.p : undefined,
    v: typeof search.v === 'string' ? search.v : undefined,
  }),
  component: BoardPage,
});

function BoardPage() {
  const { boardId } = useParams({ from: '/_app/w/$workspace/b/$boardId' });
  const { p: panelItemId, v: activeViewId = null } = Route.useSearch();
  const navigate = useNavigate();
  const profile = useAuthStore((s) => s.profile);
  const { data: board, isLoading, error } = useBoard(boardId);
  const { data: views = [] } = useViews(boardId);
  const updateLastViewed = useUpdateLastViewed();
  const restore = useRestoreBoard();

  const closePanel = () => navigate({
    to: '/w/$workspace/b/$boardId',
    params: { workspace: 'main', boardId },
    search: (prev) => ({ ...prev, p: undefined }),
  });

  const switchView = (viewId: string | null) => navigate({
    to: '/w/$workspace/b/$boardId',
    params: { workspace: 'main', boardId },
    search: (prev) => ({ ...prev, v: viewId ?? undefined }),
  });

  useEffect(() => {
    if (board && profile) void updateLastViewed.mutateAsync(board.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board?.id, profile?.id]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner className="h-6 w-6 text-brand" />
      </div>
    );
  }

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
  const canEdit = !!canManage || profile?.role === 'manager';

  const activeView = activeViewId ? views.find((v) => v.id === activeViewId) : null;
  const viewType = activeView?.type ?? 'table';

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
      <BoardTabs
        boardId={board.id}
        activeViewId={activeViewId}
        onSwitch={switchView}
        canEdit={canEdit}
      />
      {/* Toolbar (search/sort/hide/group-by/density) is table-specific in V1.
          Kanban + Calendar each manage their own internal controls. */}
      {viewType === 'table'    && <BoardToolbar boardId={board.id} canEdit={canEdit} />}
      {viewType === 'table'    && <BoardContent board={board} />}
      {viewType === 'kanban'   && <KanbanView boardId={board.id} canEdit={canEdit} />}
      {viewType === 'calendar' && <CalendarView boardId={board.id} />}
      {panelItemId && (
        <TaskPanel board={board} itemId={panelItemId} onClose={closePanel} />
      )}
    </div>
  );
}
