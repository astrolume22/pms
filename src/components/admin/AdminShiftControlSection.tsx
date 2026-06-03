/**
 * P4.7 — Admin Shift Control panel.
 *
 * Single table of every active manager with their live shift state:
 * status (active / locked / on_*_break / completed / not_started),
 * remaining time today, current mode, primary group, today's bio
 * count, and per-row actions: Lock, Unlock, Re-arm ("play again"),
 * Edit (opens the settings modal).
 *
 * Live state polled every 10s by useAdminShiftControl. Remaining
 * seconds for each row is computed client-side from the snapshotted
 * session fields (started_at + paused_total_seconds + the optional
 * current_pause_started_at) — exactly the same formula that
 * shift_tick uses server-side. Interpolated 1/sec locally between
 * polls so the displayed countdown feels smooth.
 *
 * Admin-only — the parent route already gates /admin to admins, and
 * each RPC enforces is_admin() server-side as the truth layer.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Lock, Pencil, RefreshCw, RotateCcw, Unlock } from 'lucide-react';
import { Spinner } from '@/components/Spinner';
import { EmptyMessage } from '@/components/EmptyMessage';
import {
  useAdminShiftControl,
  useShiftAdminLock,
  useShiftAdminUnlock,
  useShiftAdminRearm,
  useBioBreakPending,
  useBioBreakRequestDecide,
  type AdminShiftRow,
  type BioBreakRequestRow,
} from '@/hooks/shift';
import { AdminShiftEditModal } from './AdminShiftEditModal';
import { useAuthStore } from '@/state/authStore';
import { Check, X } from 'lucide-react';

function formatHMS(s: number): string {
  const v = Math.max(0, Math.floor(s));
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  const sec = v % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// Client-side mirror of the shift_tick elapsed formula. Used for the
// remaining-time column so we don't issue 14 shift_tick RPCs per poll.
function computeRemainingSeconds(row: AdminShiftRow, nowMs: number): number | null {
  if (!row.session_required_seconds || !row.session_started_at) return null;
  const startedMs = new Date(row.session_started_at).getTime();
  const pausedTotalMs = (row.session_paused_total_seconds ?? 0) * 1000;
  const currentPauseMs = row.session_current_pause_started_at
    ? Math.max(0, nowMs - new Date(row.session_current_pause_started_at).getTime())
    : 0;
  const elapsedMs = Math.max(0, nowMs - startedMs - pausedTotalMs - currentPauseMs);
  const remainingMs = Math.max(0, row.session_required_seconds * 1000 - elapsedMs);
  return Math.floor(remainingMs / 1000);
}

const STATUS_LABEL: Record<NonNullable<AdminShiftRow['status']>, string> = {
  not_started:   'Not started',
  active:        'Active',
  on_shift_break:'Shift break',
  on_bio_break:  'Bio break',
  locked:        'LOCKED',
  completed:     'Completed',
};
const STATUS_TONE: Record<NonNullable<AdminShiftRow['status']>, string> = {
  not_started:   'bg-slate-700/40 text-text-secondary',
  active:        'bg-emerald-900/30 text-emerald-300',
  on_shift_break:'bg-sky-900/30 text-sky-300',
  on_bio_break:  'bg-amber-900/30 text-amber-200',
  locked:        'bg-rose-900/35 text-rose-300',
  completed:     'bg-slate-800/40 text-text-secondary',
};

export function AdminShiftControlSection() {
  const profile = useAuthStore((s) => s.profile);
  const isAdmin = !!profile && (profile.role === 'admin' || profile.is_super_admin);
  const { data: rows, isLoading, refetch, isFetching } = useAdminShiftControl(isAdmin);
  const lockMut   = useShiftAdminLock();
  const unlockMut = useShiftAdminUnlock();
  const rearmMut  = useShiftAdminRearm();

  const [editRow, setEditRow] = useState<AdminShiftRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // 1/sec tick so the Remaining column counts down smoothly between
  // the 10s server polls. Just a heartbeat — the actual numbers come
  // from computeRemainingSeconds(row, now()).
  const [now, setNow] = useState<number>(() => Date.now());
  const intervalRef = useRef<number | null>(null);
  useEffect(() => {
    intervalRef.current = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  // When the server poll lands, snap the local clock to it.
  useEffect(() => { if (rows) setNow(Date.now()); }, [rows]);

  const summary = useMemo(() => {
    if (!rows) return null;
    return rows.reduce(
      (a, r) => ({
        total:    a.total + 1,
        active:   a.active + (r.status === 'active' ? 1 : 0),
        locked:   a.locked + (r.status === 'locked' ? 1 : 0),
        onBreak:  a.onBreak + (r.status === 'on_shift_break' || r.status === 'on_bio_break' ? 1 : 0),
        notStarted: a.notStarted + ((r.status === 'not_started' || r.status === null) ? 1 : 0),
      }),
      { total: 0, active: 0, locked: 0, onBreak: 0, notStarted: 0 },
    );
  }, [rows]);

  if (!isAdmin) return null;

  const runLock = async (row: AdminShiftRow) => {
    if (!row.session_id) { toast.error('No session today — nothing to lock'); return; }
    if (!confirm(`Lock ${row.full_name ?? row.username} now? They'll see the lock overlay until you unlock.`)) return;
    setBusy(row.user_id);
    try {
      await lockMut.mutateAsync({ sessionId: row.session_id, reason: 'admin' });
      toast.success(`Locked ${row.full_name ?? row.username}`);
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Lock failed'); }
    finally { setBusy(null); }
  };
  const runUnlock = async (row: AdminShiftRow) => {
    if (!row.session_id) return;
    setBusy(row.user_id);
    try {
      await unlockMut.mutateAsync(row.session_id);
      toast.success(`Unlocked ${row.full_name ?? row.username}`);
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Unlock failed'); }
    finally { setBusy(null); }
  };
  const runRearm = async (row: AdminShiftRow) => {
    if (!row.session_id) { toast.error('No session today to re-arm'); return; }
    if (!confirm(`Re-arm ${row.full_name ?? row.username}? Timer resets fresh, period index 0, bio counters cleared.`)) return;
    setBusy(row.user_id);
    try {
      await rearmMut.mutateAsync(row.session_id);
      toast.success(`Re-armed ${row.full_name ?? row.username}`);
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Re-arm failed'); }
    finally { setBusy(null); }
  };

  return (
    <section className="bg-surface border border-border-light rounded-md p-6">
      <header className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold inline-flex items-center gap-2">
            <Lock className="h-4 w-4 text-text-secondary" />
            Shift Control
          </h2>
          <p className="text-sm text-text-secondary">
            Live state of every manager + per-employee settings. Polls every 10 s.
            {summary && (
              <span className="ml-2 text-text-secondary">
                · {summary.active} active · {summary.locked} locked · {summary.onBreak} on break · {summary.notStarted} not started
              </span>
            )}
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
        <div className="flex items-center justify-center py-8"><Spinner className="h-6 w-6 text-brand" /></div>
      ) : !rows || rows.length === 0 ? (
        <EmptyMessage title="No managers" description="No active managers configured." icon={<Lock className="h-7 w-7" />} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-text-secondary border-b border-border-light">
                <th className="py-2 pr-3 font-semibold">Manager</th>
                <th className="py-2 pr-3 font-semibold">Status</th>
                <th className="py-2 pr-3 font-semibold">Remaining</th>
                <th className="py-2 pr-3 font-semibold">Mode</th>
                <th className="py-2 pr-3 font-semibold">Primary group</th>
                <th className="py-2 pr-3 font-semibold">Bio</th>
                <th className="py-2 pr-0 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const status = r.status ?? 'not_started';
                const remaining = (r.status === 'active' || r.status === 'on_shift_break' || r.status === 'on_bio_break' || r.status === 'locked')
                  ? computeRemainingSeconds(r, now)
                  : null;
                const isBusy = busy === r.user_id;
                return (
                  <tr key={r.user_id} className="border-b border-border-hair last:border-0">
                    <td className="py-2 pr-3">
                      <div className="text-text-primary font-medium">{r.full_name ?? r.username}</div>
                      <div className="text-[11px] text-text-secondary">@{r.username}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <span className={`inline-flex items-center h-6 px-2 rounded-pill text-[11px] font-semibold ${STATUS_TONE[status]}`}>
                        {STATUS_LABEL[status]}
                      </span>
                      {status === 'locked' && r.session_locked_reason && (
                        <div className="text-[10px] text-text-secondary mt-0.5">{r.session_locked_reason}</div>
                      )}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      {remaining !== null
                        ? <span className={status === 'locked' ? 'text-text-secondary' : ''}>{formatHMS(remaining)}</span>
                        : <span className="text-text-disabled">—</span>}
                    </td>
                    <td className="py-2 pr-3 capitalize">{r.mode ?? '—'}</td>
                    <td className="py-2 pr-3 truncate max-w-[180px]" title={r.primary_group_name ?? ''}>
                      {r.primary_group_name ?? <span className="text-text-disabled">—</span>}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      {r.session_bio_break_count_today ?? 0}/{r.bio_break_max_per_day ?? 7}
                    </td>
                    <td className="py-2 pr-0">
                      <div className="flex items-center justify-end gap-1.5">
                        {status === 'locked' ? (
                          <button type="button" onClick={() => void runUnlock(r)} disabled={isBusy}
                            className="btn-primary inline-flex items-center gap-1 h-8 px-2.5 text-[12px]"
                            title="Unlock now">
                            <Unlock className="h-3.5 w-3.5" /> Unlock
                          </button>
                        ) : (
                          <button type="button" onClick={() => void runLock(r)} disabled={isBusy || !r.session_id}
                            className="btn-secondary inline-flex items-center gap-1 h-8 px-2.5 text-[12px] disabled:opacity-40"
                            title="Lock this manager now">
                            <Lock className="h-3.5 w-3.5" /> Lock
                          </button>
                        )}
                        <button type="button" onClick={() => void runRearm(r)} disabled={isBusy || !r.session_id}
                          className="btn-secondary inline-flex items-center gap-1 h-8 px-2.5 text-[12px] disabled:opacity-40"
                          title="Re-arm — reset timer fresh">
                          <RotateCcw className="h-3.5 w-3.5" /> Re-arm
                        </button>
                        <button type="button" onClick={() => setEditRow(r)} disabled={isBusy}
                          className="btn-secondary inline-flex items-center gap-1 h-8 px-2.5 text-[12px]"
                          title="Edit settings">
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editRow && (
        <AdminShiftEditModal
          row={editRow}
          open={!!editRow}
          onClose={() => setEditRow(null)}
        />
      )}

      {/* P4.4 — pending bio-break approval queue */}
      <BioRequestsQueue isAdmin={isAdmin} />
    </section>
  );
}

// ---------------------------------------------------------------------
// BioRequestsQueue — small sub-component inside AdminShiftControlSection
// listing pending bio_break_requests. Admin Approve increments
// bio_break_admin_grants_today on the manager's session (server-side).
// ---------------------------------------------------------------------
function BioRequestsQueue({ isAdmin }: { isAdmin: boolean }) {
  const { data: reqs } = useBioBreakPending(isAdmin);
  const decide = useBioBreakRequestDecide();
  const [busy, setBusy] = useState<string | null>(null);

  if (!reqs || reqs.length === 0) return null;

  const handle = async (row: BioBreakRequestRow, decision: 'approved' | 'denied') => {
    setBusy(row.id);
    try {
      await decide.mutateAsync({ requestId: row.id, decision });
      toast.success(`${decision === 'approved' ? 'Approved' : 'Denied'} ${row.full_name ?? row.username}`);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Decide failed'); }
    finally { setBusy(null); }
  };

  const relAgo = (iso: string) => {
    const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (sec < 60) return `${sec}s ago`;
    const m = Math.floor(sec / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m ago`;
  };

  return (
    <div className="mt-5 pt-5 border-t border-border-light">
      <h3 className="text-[12px] font-semibold uppercase tracking-wide text-text-secondary mb-2">
        Pending bio-break requests
      </h3>
      <ul className="divide-y divide-border-hair">
        {reqs.map((r) => (
          <li key={r.id} className="flex items-center gap-3 py-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{r.full_name ?? r.username}</p>
              <p className="text-[11px] text-text-secondary">Requested {relAgo(r.requested_at)}</p>
            </div>
            <button
              type="button"
              onClick={() => void handle(r, 'approved')}
              disabled={busy === r.id}
              className="btn-primary inline-flex items-center gap-1 h-8 px-2.5 text-[12px] disabled:opacity-60"
            >
              <Check className="h-3.5 w-3.5" />
              Approve
            </button>
            <button
              type="button"
              onClick={() => void handle(r, 'denied')}
              disabled={busy === r.id}
              className="btn-secondary inline-flex items-center gap-1 h-8 px-2.5 text-[12px] disabled:opacity-60"
            >
              <X className="h-3.5 w-3.5" />
              Deny
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
