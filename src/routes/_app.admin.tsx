/**
 * /admin — admin LAYOUT with its own left sidebar.
 *
 * Previously this was a single tall page that stacked every admin
 * section. As the shift system grew (Shift Control + edit modal + Bio
 * Requests + flag chips + Group Access + AI Health + AI Runs) the page
 * became a long scroll. Splitting per-page makes each job a one-screen
 * landing.
 *
 * Routing shape:
 *   /admin                  → redirects to /admin/shift-control
 *   /admin/shift-control    → AdminShiftControlSection (+ Bio Requests inline)
 *   /admin/users            → UsersSection
 *   /admin/group-access     → GroupAccessSection
 *   /admin/ai-health        → AiHealthSection + AiRunsSection
 *
 * The beforeLoad gate here covers ALL child routes — TanStack Router
 * inherits parent beforeLoad up the tree.
 */
import { createFileRoute, redirect, Link, Outlet } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Activity, Lock, ShieldCheck, Users as UsersIcon } from 'lucide-react';
import { useAuthStore } from '@/state/authStore';

export const Route = createFileRoute('/_app/admin')({
  beforeLoad: () => {
    const profile = useAuthStore.getState().profile;
    if (!profile || (profile.role !== 'admin' && !profile.is_super_admin)) {
      toast.error('Admin access required');
      throw redirect({ to: '/' });
    }
  },
  component: AdminLayout,
});

interface NavItem {
  to: string;
  label: string;
  icon: typeof UsersIcon;
  description: string;
}

const NAV: NavItem[] = [
  { to: '/admin/shift-control', label: 'Shift Control', icon: Lock,        description: 'Live manager states + lock/unlock/end + per-employee settings' },
  { to: '/admin/users',         label: 'Users',         icon: UsersIcon,   description: 'Add / role / password / deactivate' },
  { to: '/admin/group-access',  label: 'Group access',  icon: ShieldCheck, description: 'Per-user × per-group visibility ACL' },
  { to: '/admin/ai-health',     label: 'AI health',     icon: Activity,    description: 'Status + recent runs' },
];

function AdminLayout() {
  return (
    <div className="flex h-full min-h-0">
      {/* Admin sidebar — admin/super only (the route gate above guarantees
          the visitor is admin). 220px wide, mirrors the look of the
          workspace sidebar nav rows. */}
      <aside className="w-[220px] shrink-0 border-r border-border-light bg-surface flex flex-col">
        <header className="px-4 py-4 border-b border-border-light">
          <h1 className="text-lg font-semibold">Admin</h1>
          <p className="text-[11px] text-text-secondary mt-0.5">All writes are gated server-side.</p>
        </header>
        <nav className="px-2 py-2 flex-1 overflow-y-auto">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="flex items-center gap-2 px-2 py-1.5 rounded-base text-sm hover:bg-hover transition-colors duration-100"
              activeOptions={{ exact: false }}
              activeProps={{ className: 'bg-selected text-brand font-medium' }}
              title={item.description}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          ))}
        </nav>
      </aside>

      {/* Page surface — each /admin/<page>.tsx renders inside this. */}
      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="px-8 py-6 max-w-[1200px] mx-auto space-y-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
