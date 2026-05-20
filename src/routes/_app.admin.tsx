import { createFileRoute, redirect } from '@tanstack/react-router';
import { toast } from 'sonner';
import { useAuthStore } from '@/state/authStore';

export const Route = createFileRoute('/_app/admin')({
  beforeLoad: () => {
    const profile = useAuthStore.getState().profile;
    if (!profile || (profile.role !== 'admin' && !profile.is_super_admin)) {
      toast.error('Admin access required');
      throw redirect({ to: '/' });
    }
  },
  component: AdminStub,
});

function AdminStub() {
  return (
    <div className="px-8 py-6 max-w-[1100px] mx-auto">
      <h1 className="text-3xl font-bold mb-6">Admin Panel</h1>
      <div className="bg-surface border border-border-light rounded-md p-8 text-center">
        <p className="text-text-secondary">User management arrives in Phase 6.</p>
      </div>
    </div>
  );
}
