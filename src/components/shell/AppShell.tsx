import { useEffect } from 'react';
import { Outlet } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { TopBar } from './TopBar';
import { IconRail } from './IconRail';
import { WorkspacePanel } from './WorkspacePanel';
import { useAuthStore } from '@/state/authStore';

// =====================================================================
// useRefocusInvalidate — on tab visibility flip to 'visible', invalidate
// every React Query entry whose data is older than 60s. This is what
// makes the board catch up INSTANTLY to changes Dr. John (or the user's
// other machine) made while this tab was hidden, instead of waiting up
// to 3s for the next board_watermark poll (or worse, waiting on a dead
// Realtime WebSocket that never reconnects).
//
// We only invalidate STALE-ish queries (data > 60s old). Queries that
// just refetched milliseconds ago — like a fresh shift_tick — are left
// alone so we don't burn round-trips on data that's already current.
//
// All the polls + warmup probe + 401-retry still run as before; this
// just shaves the "delay until I see today's truth" from up to 3s down
// to one round-trip. Combined with the new 3s data-plane timeout, the
// refocus-to-truth experience drops from ~6–18s to ~0.5–3s.
// =====================================================================
const STALE_WINDOW_MS = 60_000;

function useRefocusInvalidate(): void {
  const qc = useQueryClient();
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const cutoff = Date.now() - STALE_WINDOW_MS;
      void qc.invalidateQueries({
        predicate: (q) => q.state.dataUpdatedAt < cutoff,
      });
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [qc]);
}

export function AppShell() {
  useRefocusInvalidate();
  // UI polish (batch item 3): the left sidebar (IconRail = workspace
  // switcher, WorkspacePanel = Boards list + "Add new") is admin/super
  // only. Managers see no sidebar — they get only the board area, full
  // width. The role gate matches the server's is_admin() SQL helper
  // (role='admin' OR is_super_admin), the same shape used elsewhere in
  // the codebase (e.g. BoardContent's canEdit). Non-admins are routed
  // directly to their first subscribed board by _app.index.tsx, so
  // hiding the sidebar doesn't strand them.
  const profile = useAuthStore((s) => s.profile);
  const isAdmin = !!profile && (profile.role === 'admin' || profile.is_super_admin);

  return (
    <div className="h-screen flex flex-col bg-app text-text-primary">
      <TopBar />
      <div className="flex-1 flex min-h-0">
        {isAdmin && (
          <>
            <IconRail />
            <WorkspacePanel />
          </>
        )}
        <main className="flex-1 min-w-0 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
