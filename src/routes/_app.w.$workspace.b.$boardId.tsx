import { Suspense, lazy, useEffect } from 'react';
import { createFileRoute, useNavigate, useParams } from '@tanstack/react-router';
import { Lock, FileQuestion, ArchiveRestore, Archive } from 'lucide-react';
import { toast } from 'sonner';
import { useBoard, useRestoreBoard, useUpdateLastViewed } from '@/hooks/boards';
import { useAuthStore } from '@/state/authStore';
import { useViews } from '@/hooks/views';
import { useBoardRealtimeSync, useBoardWatermarkPoll } from '@/lib/boardSync';
import { useUndoShortcut } from '@/hooks/useUndoShortcut';
import { Spinner } from '@/components/Spinner';
import { EmptyMessage } from '@/components/EmptyMessage';
import { BoardHeader } from '@/components/board/BoardHeader';
import { BoardTabs } from '@/components/board/BoardTabs';
import { BoardToolbar } from '@/components/board/BoardToolbar';
// Heavy table / view / panel modules — each lives in its own chunk so the
// initial bundle stays small for the workspace home + login flows.
const BoardContent = lazy(() => import('@/components/board/BoardContent').then((m) => ({ default: m.BoardContent })));
const KanbanView   = lazy(() => import('@/components/board/views/KanbanView').then((m)   => ({ default: m.KanbanView })));
const CalendarView = lazy(() => import('@/components/board/views/CalendarView').then((m) => ({ default: m.CalendarView })));
const TaskPanel    = lazy(() => import('@/components/task/TaskPanel').then((m) => ({ default: m.TaskPanel })));

const ViewLoading = () => (
  <div className="flex items-center justify-center py-12">
    <Spinner className="h-6 w-6 text-brand" />
  </div>
);

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

  // Cross-tab + cross-machine live sync. Subscribes to Realtime
  // postgres_changes for the four board tables; any change anywhere
  // (Dr. John's laptop, your other tab, this same tab) invalidates
  // the React Query cache and refetches. Mounts when boardId is
  // known, tears down on unmount. See src/lib/boardSync.ts.
  useBoardRealtimeSync(boardId);

  // Cheap 3-second cross-device sync backstop — polls a single-
  // timestamp RPC and invalidates the heavy queries only when the
  // watermark advances. Guaranteed to land within 3 seconds even if
  // every Realtime layer is broken at the project level.
  useBoardWatermarkPoll(boardId);

  // Ctrl+Z / Cmd+Z → undo the last board action this user took in
  // this tab. Visible button lives in BoardToolbar; this hook adds
  // the keyboard shortcut. See src/lib/undoStack.ts.
  useUndoShortcut();

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

  // PERMANENT FIX for the "spinner stuck after tab refocus" bug:
  // Gate the full-screen spinner on ABSENCE OF DATA, not isLoading.
  // Once `board` lands once, any subsequent refetch keeps the previous
  // value in cache (status: 'success', fetchStatus: 'fetching') — we
  // must NOT throw the user back to a spinner on those background
  // refetches. The previous gate `if (isLoading)` was technically
  // correct in React Query v5 (isLoading = isPending && isFetching),
  // but if a corner case ever resets the query (cache eviction past
  // gcTime, manual removeQueries, etc.) the spinner would reappear.
  // Gating on `!board` makes the regression impossible.
  if (!board && isLoading) {
    console.log('[diag] BoardPage spinner -> first load', { boardId, isLoading, hasBoard: !!board });
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

  // New permission model (docs/PERMISSIONS-REDESIGN-PLAN.md):
  // Only admins / super-admins can edit board structure or non-status
  // cells. Managers can still load the board (they're subscribed) and
  // change Status cells + post comments; that path is gated per-cell
  // in CellRenderer + ItemRow, not here.
  const isAdminUser = !!profile && (profile.role === 'admin' || profile.is_super_admin);
  const canManage = isAdminUser;
  const canEdit = isAdminUser;

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
      {/* Premium polish — top chrome is exactly TWO rows now: the header
          (title + actions) and this combined sub-bar that puts view tabs
          on the left and the table toolbar (New task / Search / Sort /
          Hide / Group by / Density) on the right. */}
      <div className="px-8 pt-1 pb-2 bg-canvas flex items-center gap-2 border-b border-border-hair">
        <BoardTabs
          boardId={board.id}
          activeViewId={activeViewId}
          onSwitch={switchView}
          canEdit={canEdit}
        />
        <div className="flex-1" />
        {/* Toolbar (search/sort/hide/group-by/density) is table-specific in V1.
            Kanban + Calendar each manage their own internal controls. */}
        {viewType === 'table' && <BoardToolbar boardId={board.id} canEdit={canEdit} />}
      </div>
      <Suspense fallback={<ViewLoading />}>
        {viewType === 'table'    && <BoardContent board={board} />}
        {viewType === 'kanban'   && <KanbanView boardId={board.id} canEdit={canEdit} />}
        {viewType === 'calendar' && <CalendarView boardId={board.id} />}
      </Suspense>
      {panelItemId && (
        <Suspense fallback={null}>
          <TaskPanel board={board} itemId={panelItemId} onClose={closePanel} />
        </Suspense>
      )}
    </div>
  );
}
