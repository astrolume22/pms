import { Outlet } from '@tanstack/react-router';
import { TopBar } from './TopBar';
import { IconRail } from './IconRail';
import { WorkspacePanel } from './WorkspacePanel';
import { useAuthStore } from '@/state/authStore';

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
