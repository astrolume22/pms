/**
 * Slide-in right panel showing TaskDetail. Backdrop dim, ESC + click-out
 * to close. State driven by the `?p=<itemId>` search param on the board
 * route — no separate route needed.
 */
import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import type { BoardWithOwner } from '@/hooks/boards';
import { TaskDetail } from './TaskDetail';

interface TaskPanelProps {
  board: BoardWithOwner;
  itemId: string;
  onClose: () => void;
}

export function TaskPanel({ board, itemId, onClose }: TaskPanelProps) {
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const fullPageHref = `/w/main/b/${board.id}/i/${itemId}`;

  return (
    <div className="fixed inset-0 z-40 flex">
      {/* Backdrop — very light dim so the board behind stays visible like Monday */}
      <div
        className="flex-1 bg-black/20"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel — wider (matches Monday's ~720px task pane), big shadow on the left edge */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Task details"
        className="w-full max-w-[760px] bg-surface text-text-primary shadow-2xl flex flex-col task-panel-enter h-full border-l border-border-light"
      >
        <TaskDetail
          board={board}
          itemId={itemId}
          variant="panel"
          onClose={onClose}
          fullPageHref={fullPageHref}
          onOpenItem={(id) => navigate({
            to: '/w/$workspace/b/$boardId',
            params: { workspace: 'main', boardId: board.id },
            search: { p: id },
          })}
        />
      </aside>
    </div>
  );
}
