import { createFileRoute, Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect } from 'react';
import { ArrowLeft, FileQuestion } from 'lucide-react';
import { useBoard, useUpdateLastViewed } from '@/hooks/boards';
import { useAuthStore } from '@/state/authStore';
import { Spinner } from '@/components/Spinner';
import { EmptyMessage } from '@/components/EmptyMessage';
import { TaskDetail } from '@/components/task/TaskDetail';

export const Route = createFileRoute('/_app/w/$workspace/b/$boardId/i/$itemId')({
  component: TaskFullPage,
});

function TaskFullPage() {
  const { boardId, itemId } = useParams({ from: '/_app/w/$workspace/b/$boardId/i/$itemId' });
  const profile = useAuthStore((s) => s.profile);
  const navigate = useNavigate();
  const { data: board, isLoading, error } = useBoard(boardId);
  const updateLastViewed = useUpdateLastViewed();

  useEffect(() => {
    if (board && profile) void updateLastViewed.mutateAsync(board.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board?.id, profile?.id]);

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Spinner className="h-6 w-6 text-brand" /></div>;
  }
  if (error) {
    return (
      <EmptyMessage
        title="Couldn't load task"
        description={error instanceof Error ? error.message : 'Unknown error'}
        icon={<FileQuestion className="h-7 w-7" />}
      />
    );
  }
  if (!board) {
    return (
      <EmptyMessage
        title="Board not found"
        description="The board this task belongs to doesn't exist or you don't have access."
        icon={<FileQuestion className="h-7 w-7" />}
        action={{ label: 'Back to workspace', to: '/' }}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-2 border-b border-border-light flex items-center gap-2 bg-surface shrink-0">
        <Link
          to="/w/$workspace/b/$boardId"
          params={{ workspace: 'main', boardId: board.id }}
          className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to board
        </Link>
      </div>
      <div className="flex-1 min-h-0 max-w-[1000px] w-full mx-auto">
        <TaskDetail
          board={board}
          itemId={itemId}
          variant="full"
          onOpenItem={(id) =>
            navigate({
              to: '/w/$workspace/b/$boardId/i/$itemId',
              params: { workspace: 'main', boardId: board.id, itemId: id },
            })
          }
        />
      </div>
    </div>
  );
}
