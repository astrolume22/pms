/**
 * P4.3 — Admin Locked-Shifts queue.
 *
 * Lists every shift_session currently in status='locked', sorted oldest
 * lock first so the most-waiting manager surfaces at top. Polled every
 * 10s so new period locks land quickly. One "Unlock" button per row →
 * calls shift_admin_unlock. The row disappears from the list when the
 * row's status flips back to 'active' (via the React Query invalidation
 * already wired in useShiftAdminUnlock).
 *
 * Visible to admin/super only — the route gate in _app.admin.tsx is the
 * primary check; we also disable the query when isAdmin is false as a
 * cheap second layer.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { Lock, RefreshCw, Unlock } from 'lucide-react';
import { Spinner } from '@/components/Spinner';
import { EmptyMessage } from '@/components/EmptyMessage';
import { useLockedShifts, useShiftAdminUnlock, type LockedShiftRow } from '@/hooks/shift';
import { useAuthStore } from '@/state/authStore';

function relativeWait(iso: string): string {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const sec = Math.max(0, Math.floor((now - t) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${sec % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function LockedShiftsSection() {
  const profile = useAuthStore((s) => s.profile);
  const isAdmin = !!profile && (profile.role === 'admin' || profile.is_super_admin);
  const { data: rows, isLoading, refetch, isFetching } = useLockedShifts(isAdmin);
  const unlock = useShiftAdminUnlock();
  const [pending, setPending] = useState<string | null>(null);

  if (!isAdmin) return null;

  const handleUnlock = async (row: LockedShiftRow) => {
    setPending(row.id);
    try {
      await unlock.mutateAsync(row.id);
      toast.success(`Unlocked ${row.full_name ?? row.username}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unlock failed');
    } finally {
      setPending(null);
    }
  };

  return (
    <section className="bg-surface border border-border-light rounded-md p-6">
      <header className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold inline-flex items-center gap-2">
            <Lock className="h-4 w-4 text-text-secondary" />
            Locked Shifts
          </h2>
          <p className="text-sm text-text-secondary">
            Managers waiting for an unlock. Polls every 10 seconds.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          title="Refresh"
          className="h-9 w-9 inline-flex items-center justify-center rounded-base text-text-secondary hover:bg-hover disabled:opacity-40"
          aria-label="Refresh"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
        </button>
      </header>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Spinner className="h-6 w-6 text-brand" />
        </div>
      ) : !rows || rows.length === 0 ? (
        <EmptyMessage
          title="No locked shifts"
          description="All managers are running normally."
          icon={<Lock className="h-7 w-7" />}
        />
      ) : (
        <ul className="divide-y divide-border-hair">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">
                  {r.full_name ?? r.username}
                </p>
                <p className="text-xs text-text-secondary">
                  Locked {relativeWait(r.locked_at)} ago · reason: {r.locked_reason ?? '—'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleUnlock(r)}
                disabled={pending === r.id}
                className="btn-primary inline-flex items-center gap-2 h-9 px-3 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <Unlock className="h-4 w-4" />
                {pending === r.id ? 'Unlocking…' : 'Unlock'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
