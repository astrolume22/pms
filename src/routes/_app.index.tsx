import { useMemo, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Clock, FolderOpen, Users, Lock, Globe, Star } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Avatar } from '@/components/Avatar';
import { RoleBadge } from '@/components/RoleBadge';
import { Spinner } from '@/components/Spinner';
import { EmptyMessage } from '@/components/EmptyMessage';
import { useBoards, useRecentBoards, type BoardListItem } from '@/hooks/boards';
import { useAuthStore } from '@/state/authStore';
import { cn } from '@/lib/cn';
import type { UserRow } from '@/lib/database.types';

export const Route = createFileRoute('/_app/')({
  component: WorkspaceHome,
});

type Tab = 'recents' | 'content' | 'collaborators';

function WorkspaceHome() {
  const [tab, setTab] = useState<Tab>('recents');

  return (
    <div className="px-8 py-6 max-w-[1100px] mx-auto">
      <h1 className="text-3xl font-bold mb-6">Main workspace</h1>

      <div className="border-b border-border-light flex items-center gap-1 mb-6">
        {(['recents', 'content', 'collaborators'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors duration-100 inline-flex items-center gap-1.5',
              tab === t
                ? 'border-brand text-brand'
                : 'border-transparent text-text-secondary hover:text-text-primary',
            )}
          >
            {iconFor(t)}
            {labelFor(t)}
          </button>
        ))}
      </div>

      {tab === 'recents' && <RecentsTab />}
      {tab === 'content' && <ContentTab />}
      {tab === 'collaborators' && <CollaboratorsTab />}
    </div>
  );
}

function iconFor(t: Tab) {
  if (t === 'recents') return <Clock className="h-4 w-4" />;
  if (t === 'content') return <FolderOpen className="h-4 w-4" />;
  return <Users className="h-4 w-4" />;
}
function labelFor(t: Tab) {
  return t === 'recents' ? 'Recents' : t === 'content' ? 'Content' : 'Collaborators';
}

// ----------------------------------------------------------------------
// Recents
// ----------------------------------------------------------------------
function RecentsTab() {
  const { data, isLoading } = useRecentBoards(20);
  if (isLoading) return <div className="flex justify-center py-10"><Spinner className="h-6 w-6 text-brand" /></div>;
  if (!data || data.length === 0) {
    return (
      <EmptyMessage
        title="No recent items"
        description="Boards you open will show up here."
        icon={<Clock className="h-7 w-7" />}
      />
    );
  }
  return (
    <div className="bg-surface border border-border-light rounded-md overflow-hidden">
      <ul className="divide-y divide-border-light">
        {data.map((r) => (
          <li key={r.board.id}>
            <Link
              to="/w/$workspace/b/$boardId"
              params={{ workspace: 'main', boardId: r.board.id }}
              className="flex items-center gap-3 px-4 py-3 hover:bg-hover transition-colors duration-100"
            >
              <span className="text-xl">{r.board.icon_emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{r.board.name}</p>
                <p className="text-xs text-text-secondary truncate">
                  {r.board.description || '—'}
                </p>
              </div>
              <BoardTypeChip type={r.board.board_type} />
              <span className="text-xs text-text-secondary w-24 text-right">
                {relativeTime(r.last_viewed_at)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ----------------------------------------------------------------------
// Content
// ----------------------------------------------------------------------
function ContentTab() {
  const { data, isLoading } = useBoards();
  const visible = useMemo(() => (data ?? []).filter((b) => !b.archived_at), [data]);

  const { data: owners } = useQuery({
    queryKey: ['boards-owners', visible.map((b) => b.owner_id).sort().join(',')],
    enabled: visible.length > 0,
    queryFn: async () => {
      const ids = Array.from(new Set(visible.map((b) => b.owner_id)));
      const { data, error } = await supabase
        .from('users')
        .select('id, username, full_name, avatar_url')
        .in('id', ids);
      if (error) throw error;
      return new Map(
        ((data ?? []) as Pick<UserRow, 'id' | 'username' | 'full_name' | 'avatar_url'>[]).map((u) => [u.id, u]),
      );
    },
  });

  if (isLoading) return <div className="flex justify-center py-10"><Spinner className="h-6 w-6 text-brand" /></div>;
  if (visible.length === 0) {
    return (
      <EmptyMessage
        title="No content yet"
        description="Create your first board from the sidebar to get started."
        icon={<FolderOpen className="h-7 w-7" />}
      />
    );
  }

  return (
    <div className="bg-surface border border-border-light rounded-md overflow-hidden">
      <div className="grid grid-cols-[1.5fr_100px_180px_120px_120px] items-center px-4 py-2 text-xs uppercase tracking-wide text-text-secondary font-medium border-b border-border-light bg-app/60">
        <span>Name</span>
        <span>Type</span>
        <span>Owner</span>
        <span>Created</span>
        <span>Updated</span>
      </div>
      <ul className="divide-y divide-border-light">
        {visible.map((b) => (
          <ContentRow key={b.id} board={b} owner={owners?.get(b.owner_id)} />
        ))}
      </ul>
    </div>
  );
}

function ContentRow({
  board,
  owner,
}: {
  board: BoardListItem;
  owner?: Pick<UserRow, 'id' | 'username' | 'full_name' | 'avatar_url'>;
}) {
  return (
    <li>
      <Link
        to="/w/$workspace/b/$boardId"
        params={{ workspace: 'main', boardId: board.id }}
        className="grid grid-cols-[1.5fr_100px_180px_120px_120px] items-center px-4 py-3 hover:bg-hover transition-colors duration-100 text-sm"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-base shrink-0">{board.icon_emoji}</span>
          <span className="truncate font-medium">{board.name}</span>
          {board.is_favorite && <Star className="h-3 w-3 fill-warning text-warning shrink-0" />}
        </span>
        <BoardTypeChip type={board.board_type} />
        {owner ? (
          <span className="flex items-center gap-1.5 min-w-0">
            <Avatar name={owner.full_name ?? owner.username} url={owner.avatar_url} size="xs" />
            <span className="truncate">@{owner.username}</span>
          </span>
        ) : (
          <span className="text-text-disabled">—</span>
        )}
        <span className="text-text-secondary">{new Date(board.created_at).toLocaleDateString()}</span>
        <span className="text-text-secondary">{new Date(board.updated_at).toLocaleDateString()}</span>
      </Link>
    </li>
  );
}

function BoardTypeChip({ type }: { type: 'main' | 'private' }) {
  if (type === 'private') {
    return (
      <span className="inline-flex items-center gap-1 h-5 px-2 rounded-pill text-xs font-medium bg-label-purple/15 text-label-purple w-fit">
        <Lock className="h-3 w-3" />
        Private
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 h-5 px-2 rounded-pill text-xs font-medium bg-brand/15 text-brand w-fit">
      <Globe className="h-3 w-3" />
      Main
    </span>
  );
}

// ----------------------------------------------------------------------
// Collaborators
// ----------------------------------------------------------------------
function CollaboratorsTab() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['collaborators'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('status', 'active')
        .order('role', { ascending: true })
        .order('username', { ascending: true });
      if (error) throw error;
      return data as UserRow[];
    },
  });

  if (isLoading) return <div className="flex justify-center py-10"><Spinner className="h-6 w-6 text-brand" /></div>;
  if (error) return <p className="text-error text-sm">Failed to load collaborators.</p>;
  if (!data || data.length === 0) {
    return <EmptyMessage title="No collaborators" description="Invite teammates from the admin panel." icon={<Users className="h-7 w-7" />} />;
  }

  return (
    <div className="bg-surface border border-border-light rounded-md overflow-hidden">
      <ul className="divide-y divide-border-light">
        {data.map((u) => (
          <li key={u.id} className="flex items-center gap-4 px-4 py-3 hover:bg-hover transition-colors duration-100">
            <Avatar name={u.full_name ?? u.username} url={u.avatar_url} size="md" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{u.full_name ?? u.username}</p>
              <p className="text-xs text-text-secondary truncate">@{u.username}</p>
            </div>
            <RoleBadge role={u.role} />
          </li>
        ))}
      </ul>
    </div>
  );
}

// ----------------------------------------------------------------------
// Utilities
// ----------------------------------------------------------------------
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
