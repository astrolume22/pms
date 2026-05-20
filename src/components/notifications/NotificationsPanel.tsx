import { useEffect, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Bell, CheckCheck, X } from 'lucide-react';
import { useMarkAllRead, useMarkRead, useNotifications } from '@/hooks/notifications';
import { useActiveUsers } from '@/hooks/users';
import { useBoardItems } from '@/hooks/items';
import { Avatar } from '@/components/Avatar';
import { EmptyMessage } from '@/components/EmptyMessage';
import { Spinner } from '@/components/Spinner';
import type { NotificationRow, NotificationType } from '@/lib/database.types';
import { cn } from '@/lib/cn';

interface NotificationsPanelProps {
  onClose: () => void;
}

export function NotificationsPanel({ onClose }: NotificationsPanelProps) {
  const navigate = useNavigate();
  const { data, isLoading } = useNotifications(50);
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const { data: users } = useActiveUsers();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [onClose]);

  const onActivate = async (n: NotificationRow) => {
    if (!n.is_read) await markRead.mutateAsync(n.id);
    onClose();
    if (n.board_id && n.item_id) {
      navigate({
        to: '/w/$workspace/b/$boardId',
        params: { workspace: 'main', boardId: n.board_id },
        search: { p: n.item_id },
      });
    } else if (n.board_id) {
      navigate({
        to: '/w/$workspace/b/$boardId',
        params: { workspace: 'main', boardId: n.board_id },
        search: {},
      });
    }
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Notifications"
      className="absolute right-0 top-10 z-50 w-[360px] max-h-[520px] bg-surface text-text-primary border border-border-light rounded-md shadow-xl overflow-hidden flex flex-col"
    >
      <header className="flex items-center justify-between px-3 py-2 border-b border-border-light shrink-0">
        <h2 className="text-sm font-semibold">Notifications</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void markAll.mutateAsync()}
            className="h-7 inline-flex items-center gap-1 px-2 rounded-sm text-xs text-text-secondary hover:bg-hover"
            title="Mark all read"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Mark all read
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="h-7 w-7 inline-flex items-center justify-center rounded-sm text-text-secondary hover:bg-hover"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Spinner className="h-5 w-5 text-brand" />
          </div>
        ) : !data || data.length === 0 ? (
          <EmptyMessage title="You rock!" description="No notifications right now." icon={<Bell className="h-6 w-6" />} />
        ) : (
          <ul>
            {data.map((n) => {
              const actor = users?.find((u) => u.id === n.actor_id);
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => void onActivate(n)}
                    className={cn(
                      'w-full text-left px-3 py-2 flex items-start gap-2 border-b border-border-light last:border-b-0 hover:bg-hover',
                      !n.is_read && 'bg-selected/40',
                    )}
                  >
                    <Avatar
                      name={actor?.full_name ?? actor?.username ?? '?'}
                      url={actor?.avatar_url ?? null}
                      size="sm"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-snug">
                        <span className="font-medium">{actor?.full_name ?? actor?.username ?? 'Someone'}</span>{' '}
                        <span className="text-text-secondary">{renderMessage(n.type)}</span>
                      </p>
                      <ItemContext itemId={n.item_id ?? null} boardId={n.board_id ?? null} />
                      <p className="text-[11px] text-text-disabled mt-0.5">{relativeTime(n.created_at)}</p>
                    </div>
                    {!n.is_read && <span className="h-2 w-2 rounded-pill bg-brand shrink-0 mt-1" aria-label="Unread" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function renderMessage(type: NotificationType): string {
  switch (type) {
    case 'mention':         return 'mentioned you in an update';
    case 'comment':         return 'commented on your task';
    case 'assigned':        return 'assigned you to a task';
    case 'status_changed':  return 'changed a status';
    case 'due_date':        return 'set a due date';
    case 'task_updated':    return 'updated a task';
  }
}

function ItemContext({ itemId, boardId }: { itemId: string | null; boardId: string | null }) {
  // Light-touch enrichment: surface the task name if we have it cached.
  const { data: items } = useBoardItems(boardId ?? undefined);
  if (!itemId || !items) return null;
  const item = items.items.find((i) => i.id === itemId);
  if (!item) return null;
  return (
    <p className="text-xs text-text-secondary truncate mt-0.5">
      <span className="text-text-disabled font-mono">{item.task_code}</span>
      {' · '}
      {item.name}
    </p>
  );
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}
