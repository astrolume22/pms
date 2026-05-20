import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Avatar } from '@/components/Avatar';
import { RoleBadge } from '@/components/RoleBadge';
import { Spinner } from '@/components/Spinner';
import { Inbox } from 'lucide-react';
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
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors duration-100',
              tab === t
                ? 'border-brand text-brand'
                : 'border-transparent text-text-secondary hover:text-text-primary',
            )}
          >
            {label(t)}
          </button>
        ))}
      </div>

      {tab === 'recents' && <EmptyState title="No recent items" subtitle="Boards and items you visit will appear here." />}
      {tab === 'content' && <EmptyState title="No content yet" subtitle="Create your first board to get started." />}
      {tab === 'collaborators' && <Collaborators />}
    </div>
  );
}

function label(t: Tab): string {
  return t === 'recents' ? 'Recents' : t === 'content' ? 'Content' : 'Collaborators';
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="bg-surface border border-border-light rounded-md p-12 flex flex-col items-center justify-center text-center">
      <div className="h-14 w-14 rounded-pill bg-app flex items-center justify-center mb-4">
        <Inbox className="h-7 w-7 text-text-secondary" />
      </div>
      <h3 className="text-lg font-semibold mb-1">{title}</h3>
      <p className="text-sm text-text-secondary">{subtitle}</p>
    </div>
  );
}

function Collaborators() {
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
  if (!data || data.length === 0) return <EmptyState title="No collaborators" subtitle="Invite teammates from the admin panel." />;

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
