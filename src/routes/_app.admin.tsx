/**
 * /admin — admin-only landing page.
 *
 * Phase 6 (users) + Phase 2 AI engine (status block + recent runs).
 * The legacy GeminiKeySection (DB-encrypted per-account key) was retired
 * — the new engine reads GEMINI_API_KEY from Vercel env vars instead.
 * See migration 0032 + docs/AI-ENGINE.md.
 */
import { createFileRoute, redirect } from '@tanstack/react-router';
import { toast } from 'sonner';
import { useAuthStore } from '@/state/authStore';
import { UsersSection } from '@/components/admin/UsersSection';
import { GroupAccessSection } from '@/components/admin/GroupAccessSection';
import { AdminShiftControlSection } from '@/components/admin/AdminShiftControlSection';
import { AiHealthSection } from '@/components/admin/AiHealthSection';
import { AiRunsSection } from '@/components/admin/AiRunsSection';
// LockedShiftsSection is now folded into AdminShiftControlSection — the
// unified panel exposes Unlock per row in the locked state. The file
// stays in the repo as a fallback / standalone widget.

export const Route = createFileRoute('/_app/admin')({
  beforeLoad: () => {
    const profile = useAuthStore.getState().profile;
    if (!profile || (profile.role !== 'admin' && !profile.is_super_admin)) {
      toast.error('Admin access required');
      throw redirect({ to: '/' });
    }
  },
  component: AdminPage,
});

function AdminPage() {
  return (
    <div className="px-8 py-6 max-w-[1000px] mx-auto space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Admin Panel</h1>
        <p className="text-sm text-text-secondary mt-1">
          User management + AI engine observability. All writes are gated server-side.
        </p>
      </header>

      <UsersSection />
      <GroupAccessSection />
      <AdminShiftControlSection />
      <AiHealthSection />
      <AiRunsSection />
    </div>
  );
}
