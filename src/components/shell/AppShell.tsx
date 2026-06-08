import { Outlet } from '@tanstack/react-router';
import { TopBar } from './TopBar';
import { IconRail } from './IconRail';
import { WorkspacePanel } from './WorkspacePanel';
import { useAuthStore } from '@/state/authStore';

// =====================================================================
// Simplified data-loading model (founder decision):
//
// All focus-driven query machinery has been REMOVED from this shell.
// A tab refocus is now a complete no-op at the shell level — no
// invalidate, no paused-kick, no zombie-fetch rekick, no blur/focus/
// visibilitychange listeners, no online/offline diag. Data simply
// loads when a page mounts; to see another machine's changes the user
// refreshes / reopens the board (cross-machine live sync is
// intentionally dropped here).
//
// Paired with src/lib/supabase.ts having autoRefreshToken:false, this
// means a refocus event causes ZERO supabase activity. The only thing
// that ever touches auth on focus is the user themselves clicking
// something, and tokens rotate lazily via timeoutFetch's 401-retry.
// =====================================================================
export function AppShell() {
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
