import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Home, ChevronDown, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { WorkspaceRow } from '@/lib/database.types';

export function WorkspacePanel() {
  const { data: workspace } = useQuery({
    queryKey: ['workspace', 'main'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workspaces')
        .select('*')
        .eq('is_main', true)
        .maybeSingle();
      if (error) throw error;
      return (data as WorkspaceRow | null) ?? null;
    },
  });

  return (
    <aside className="w-60 shrink-0 border-r border-border-light bg-surface flex flex-col">
      {/* Workspace switcher */}
      <div className="p-3 border-b border-border-light">
        <button
          type="button"
          className="w-full flex items-center gap-2 px-2 py-2 rounded-base hover:bg-hover transition-colors duration-100 text-left"
        >
          <span
            className="h-6 w-6 inline-flex items-center justify-center rounded-base text-white text-xs font-medium"
            style={{ background: workspace?.icon_color ?? '#0073EA' }}
          >
            {workspace?.icon_emoji ?? '🏠'}
          </span>
          <span className="text-sm font-medium flex-1 truncate">
            {workspace?.name ?? 'Main workspace'}
          </span>
          <ChevronDown className="h-4 w-4 text-text-secondary" />
        </button>
      </div>

      {/* Navigation */}
      <div className="px-2 py-2 flex-1 overflow-y-auto">
        <Link
          to="/"
          className="flex items-center gap-2 px-2 py-1.5 rounded-base text-sm hover:bg-hover transition-colors duration-100"
          activeProps={{ className: 'bg-selected text-brand font-medium' }}
        >
          <Home className="h-4 w-4" />
          <span>Workspace home</span>
        </Link>

        <div className="mt-4">
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-xs uppercase tracking-wide text-text-secondary font-medium">
              Boards
            </span>
            <button
              type="button"
              aria-label="Add board"
              title="Add board"
              className="h-5 w-5 inline-flex items-center justify-center rounded-sm text-text-secondary hover:bg-hover"
              disabled
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="px-2 py-1 text-xs text-text-disabled">No boards yet</p>
        </div>
      </div>
    </aside>
  );
}
