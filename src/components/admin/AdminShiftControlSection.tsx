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
import { Lock, Pause, Pencil, Play, RefreshCw, RotateCcw, ListChecks, SkipForward } from 'lucide-react';
import { UserActivityPanel } from './UserActivityPanel';
import { Spinner } from '@/components/Spinner';
import { EmptyMessage } from '@/components/EmptyMessage';
import {
  useAdminShiftControl,
  useShiftAdminSetAccountLock,
  useShiftAdminUnlock,
  useShiftAdminRearm,
  useShiftAdminForceEnd,
  useShiftAdminSkipNextLock,
  type AdminShiftRow,
} from '@/hooks/shift';
import { AdminShiftEditModal } from './AdminShiftEditModal';
import { useAuthStore } from '@/state/authStore';
// 0067 — Check, X icons used to live in BioRequestsQueue which has been
// removed (bio is now a hard limit, no admin approval flow). Keep Square
// (force-end + early-end flag pill) and Clock (late-start flag pill).
import { Square, Clock } from 'lucide-react';

// =====================================================================
// LockToggle — a navy/gold inline switch built on a styled
// <input type="checkbox"> + sibling <span> track.
//
// As of "unified lock toggle": this switch is the SINGLE SOURCE OF TRUTH
// for "is this manager currently blocked from working?" — covering BOTH
// lock types in one control:
//   • `checked === true` when EITHER
//        – shift_configs.account_locked = true   (permanent admin lock, 0064)
//        – today's shift_sessions.status = 'locked' (auto period-lock from
//          shift_self_period_lock OR a manual shift_admin_lock)
//   • Toggle OFF runs whichever paths apply (could be both):
//        – account_locked → shift_admin_set_account_lock(user, false)
//        – session locked → shift_admin_unlock(session_id)
//                       + shift_admin_rearm(session_id)
//          (unlock satisfies the status='locked' precondition + writes
//           the audit event; rearm zeroes the clock so the very next tick
//           does NOT instantly re-lock at the previous period boundary.)
//   • Toggle ON applies the strongest lock — account_locked = true. This
//     also blocks shift_start server-side via the 0064 guard.
//   • `disabled` is ONLY for the brief window while a mutation is in
//     flight (isBusy). NEVER tied to session_id presence: the toggle
//     must work for offline / no-session-today / brand-new / auto-locked
//     managers alike.
//   • Pure CSS, no new dependency.
// =====================================================================
function LockToggle({
  checked, disabled, onToggle, idAttr,
}: {
  checked: boolean;
  disabled: boolean;
  onToggle: (next: boolean) => void;
  idAttr: string;
}) {
  return (
    <label
      htmlFor={idAttr}
      className={
        'inline-flex items-center gap-2 select-none ' +
        (disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')
      }
      title={checked ? 'Locked — flip OFF to unlock' : 'Unlocked — flip ON to lock'}
    >
      <span className="relative inline-flex items-center">
        <input
          id={idAttr}
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onToggle(e.target.checked)}
          // Visually hidden; the styled span beside is the visible track.
          className="peer sr-only"
        />
        {/* Track */}
        <span
          aria-hidden
          className={
            'block h-5 w-9 rounded-full transition-colors duration-150 ' +
            (checked
              ? 'bg-brand'                // navy when locked
              : 'bg-slate-700/60') +
            ' peer-focus-visible:ring-2 peer-focus-visible:ring-amber-400/60'
          }
        />
        {/* Knob — slides right when checked. Gold when ON for the navy/gold accent. */}
        <span
          aria-hidden
          className={
            'absolute top-0.5 left-0.5 h-4 w-4 rounded-full shadow-sm transition-transform duration-150 ' +
            (checked
              ? 'translate-x-4 bg-amber-300'    // gold knob = locked
              : 'translate-x-0 bg-slate-200')
          }
        />
      </span>
      <span className={
        'text-[12px] font-medium tabular-nums w-[60px] ' +
        (checked ? 'text-amber-200' : 'text-text-secondary')
      }>
        {checked ? 'Locked' : 'Unlocked'}
      </span>
    </label>
  );
}

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
  const setAccountLock = useShiftAdminSetAccountLock();
  const unlockMut  = useShiftAdminUnlock();
  const rearmMut   = useShiftAdminRearm();
  const forceMut   = useShiftAdminForceEnd();
  const skipNextMut = useShiftAdminSkipNextLock();

  const [editRow, setEditRow] = useState<AdminShiftRow | null>(null);
  const [activityRow, setActivityRow] = useState<AdminShiftRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Per-user optimistic lock override.
  //
  // Flicker fix — RECONCILE-ON-MATCH (not "clear in finally"):
  //   The toggle flips → override is set to `next` immediately so the
  //   switch animates without waiting for the network.
  //   The override is then KEPT until the polled `rows` actually
  //   reflects the new server state. An effect below watches `rows`
  //   and clears any user's override ONLY when the polled row's
  //   derived locked state == that user's override. This eliminates
  //   the old finally-clear → stale-poll → next-poll-flip cycle that
  //   caused the on→off→on flicker.
  //
  // Cleared in two cases:
  //   • RECONCILE: polled row's derived state matches the override.
  //   • REVERT  : the RPC threw (manual clear in the catch block).
  const [lockOverrides, setLockOverrides] = useState<Map<string, boolean>>(() => new Map());
  const clearLockOverride = (userId: string) => {
    setLockOverrides((prev) => {
      if (!prev.has(userId)) return prev;
      const next = new Map(prev);
      next.delete(userId);
      return next;
    });
  };

  // Reconcile-on-match: when the 10s poll lands, drop overrides whose
  // server state has caught up. This is the ONLY non-error path that
  // clears an override, so the optimistic UI never reverts to stale
  // data and never flips on the in-between poll.
  useEffect(() => {
    if (!rows) return;
    if (lockOverrides.size === 0) return;
    setLockOverrides((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Map(prev);
      for (const [userId, want] of prev) {
        const row = rows.find((r) => r.user_id === userId);
        if (!row) continue;
        const have = (row.account_locked ?? false) || row.status === 'locked';
        if (have === want) {
          next.delete(userId);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [rows, lockOverrides]);

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

  // Unified flip handler — ONE switch reflects+controls BOTH lock types.
  //
  // Toggle ON (admin lock):
  //   • Always applies the ACCOUNT-level lock (the strongest — also blocks
  //     shift_start server-side via the 0064 guard at the SQL layer).
  //   • Works regardless of session_id — offline / no-session-today /
  //     brand-new managers are all lockable.
  //
  // Toggle OFF (admin unlock — free the manager to work whatever the cause):
  //   • If account_locked === true → shift_admin_set_account_lock(user, false).
  //     (As of migration 0065, that RPC ALSO finalizes any admin-paused
  //     session — credits the pause duration to paused_total_seconds and
  //     restores status='active'. So zero time is lost during the lock.)
  //   • If the session is in a TRUE period-lock (status='locked' AND
  //     session_locked_reason='period_lock'), call shift_admin_unlock —
  //     and ONLY shift_admin_unlock. It cleanly resumes the session:
  //     status='active', credits the pause to paused_total_seconds,
  //     advances current_period_index by 1 so the next period boundary
  //     moves forward and shift_tick does NOT immediately report
  //     period_lock_due=true again.
  //
  //   • CRITICAL — we do NOT call shift_admin_rearm here. Rearm is a
  //     deliberate FULL RESET (started_at=now(), paused_total_seconds=0,
  //     period_index=0, bio_break_count_today=0,
  //     bio_break_total_seconds_today=0). Calling it on unlock was the
  //     founder's bug: the manager's bio break counter was zeroed every
  //     time the periodic lock fired and the admin unlocked them.
  //
  //     Rearm stays wired to the separate "Re-arm" button (runRearm
  //     below) which the admin clicks deliberately. That is the ONLY
  //     path that resets counts/timer.
  //   • Both account-unlock and period-unlock run when both apply.
  //
  // Optimistic flip BEFORE await so the switch animates immediately.
  // Override is RECONCILED with the polled row (see the effect above) —
  // never cleared in finally — so there's no on→off→on flip while the
  // 10s poll catches up.
  const runLockToggle = async (row: AdminShiftRow, next: boolean) => {
    setLockOverrides((prev) => {
      const m = new Map(prev);
      m.set(row.user_id, next);
      return m;
    });
    setBusy(row.user_id);
    try {
      if (next) {
        await setAccountLock.mutateAsync({ targetUserId: row.user_id, locked: true });
        toast.success(`Locked ${row.full_name ?? row.username}`);
      } else {
        const ranAccount = row.account_locked === true;
        const ranPeriod  = row.status === 'locked'
                        && row.session_locked_reason === 'period_lock'
                        && !!row.session_id;
        if (ranAccount) {
          await setAccountLock.mutateAsync({ targetUserId: row.user_id, locked: false });
        }
        if (ranPeriod) {
          // ONLY resume — no rearm. shift_admin_unlock advances the
          // period index by 1 so a re-lock is impossible until the
          // next period actually ends.
          await unlockMut.mutateAsync(row.session_id!);
        }
        const who = row.full_name ?? row.username;
        const msg =
          ranAccount && ranPeriod ? `Unlocked ${who} — account + period lock cleared, break counts preserved` :
          ranAccount               ? `Unlocked ${who}'s account` :
          ranPeriod                ? `Unlocked ${who} — period lock cleared, break counts preserved` :
                                     `Unlocked ${who}`;
        toast.success(msg);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : (next ? 'Lock failed' : 'Unlock failed'));
      // Revert the optimistic flip on error so the toggle snaps back to
      // server truth. Reconcile-on-match handles the success path.
      clearLockOverride(row.user_id);
    } finally {
      setBusy(null);
    }
  };
  const runForceEnd = async (row: AdminShiftRow) => {
    if (!row.session_id) { toast.error('No session today — nothing to end'); return; }
    if (!confirm(`Force end ${row.full_name ?? row.username}'s shift NOW? Their session will be marked completed regardless of elapsed time. If before their expected end, an early_end_flag is recorded.`)) return;
    setBusy(row.user_id);
    try {
      const r = await forceMut.mutateAsync(row.session_id);
      const tag = r.early_end_flag ? ` (early by ${r.early_end_minutes ?? '?'} min)` : '';
      toast.success(`Force-ended ${row.full_name ?? row.username}${tag}`);
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Force-end failed'); }
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

  // 0075 — admin arms the one-shot "skip next period lock" flag for the
  // selected manager's session. Server-side, the very next
  // shift_self_period_lock call will consume the flag (NOT lock + advance
  // current_period_index by 1); the period after that locks normally.
  // Works whether the user is online or offline — the flag lives on the
  // session row and is read at lock time, not at click time.
  const runSkipNext = async (row: AdminShiftRow) => {
    if (!row.session_id) { toast.error('No session today to skip'); return; }
    setBusy(row.user_id);
    try {
      await skipNextMut.mutateAsync(row.session_id);
      toast.success(`Next lock will be skipped for ${row.full_name ?? row.username}.`);
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Skip-next failed'); }
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
                      {/* P4.5 — flag chips */}
                      {r.late_start_flag === true && (
                        <span className="inline-flex items-center gap-1 h-5 px-1.5 mt-1 mr-1 rounded-pill text-[10px] font-semibold bg-amber-900/30 text-amber-200" title={`Started ${r.late_start_minutes ?? '?'} min after scheduled start`}>
                          <Clock className="h-3 w-3" />
                          Late {r.late_start_minutes}m
                        </span>
                      )}
                      {r.early_end_flag === true && (
                        <span className="inline-flex items-center gap-1 h-5 px-1.5 mt-1 rounded-pill text-[10px] font-semibold bg-rose-900/30 text-rose-200" title={`Ended ${r.early_end_minutes ?? '?'} min before expected end`}>
                          <Square className="h-3 w-3" />
                          Early end {r.early_end_minutes}m
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      {/*
                        Founder requirement: the admin must SEE whether
                        each manager's timer is currently FROZEN (paused
                        by a lock — period_lock or admin lock) vs
                        RUNNING (active / on a paid break).

                        - status='locked' → amber "Paused (locked)" badge
                          + the remaining value shown bold-amber. The
                          value is the FROZEN snapshot at lock time —
                          our computeRemainingSeconds mirrors the server
                          shift_tick formula so it does NOT decrement
                          while paused.
                        - status='active' / 'on_*_break' → green "Running"
                          badge + live-decrementing remaining (breaks are
                          paid, timer keeps running — DECISION 1).
                      */}
                      {remaining !== null ? (
                        <div className="flex flex-col items-start gap-1">
                          <span className={status === 'locked' ? 'text-amber-200 font-semibold' : ''}>
                            {formatHMS(remaining)}
                          </span>
                          {status === 'locked' ? (
                            <span className="inline-flex items-center gap-1 h-5 px-1.5 rounded-pill text-[10px] font-semibold bg-amber-900/35 text-amber-200">
                              <Pause className="h-2.5 w-2.5" />
                              Paused (locked)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 h-5 px-1.5 rounded-pill text-[10px] font-semibold bg-emerald-900/30 text-emerald-300">
                              <Play className="h-2.5 w-2.5" />
                              Running
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-text-disabled">—</span>
                      )}
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
                        {/*
                          UNIFIED lock toggle. `checked` is the OR of:
                            • shift_configs.account_locked = true (0064
                              permanent admin lock, also blocks shift_start)
                            • today's shift_sessions.status = 'locked'
                              (auto period-lock OR a manual shift_admin_lock)
                          So an auto-locked manager shows the toggle ON,
                          and the admin can unlock them right here. NEVER
                          disabled for missing session — `disabled` only
                          fires while this toggle's own mutation is in
                          flight (isBusy). The session-level "Paused
                          (locked)" badge in the Remaining column AND the
                          LockedShiftsSection panel are preserved as-is.
                        */}
                        <div className="flex flex-col items-end gap-0.5">
                          <LockToggle
                            idAttr={`lock-toggle-${r.user_id}`}
                            checked={lockOverrides.get(r.user_id) ?? ((r.account_locked ?? false) || r.status === 'locked')}
                            disabled={isBusy}
                            onToggle={(next) => void runLockToggle(r, next)}
                          />
                          {(() => {
                            const ov  = lockOverrides.get(r.user_id);
                            const eff = ov ?? ((r.account_locked ?? false) || r.status === 'locked');
                            if (!eff) return null;
                            // Optimistic ON → just-applied account lock.
                            // Otherwise reflect the strongest active source
                            // (account_locked wins; else period lock).
                            const showAccount = ov === true || r.account_locked === true;
                            const label = showAccount ? 'Account locked' : 'Period locked';
                            const title = showAccount
                              ? (r.account_locked_at ? `Account locked since ${new Date(r.account_locked_at).toLocaleString()}` : 'Account locked')
                              : (r.session_locked_reason ? `Session ${r.session_locked_reason}` : 'Session locked');
                            return (
                              <span className="text-[10px] font-medium text-amber-200/80" title={title}>
                                {label}
                              </span>
                            );
                          })()}
                        </div>
                        <button type="button" onClick={() => setActivityRow(r)} disabled={isBusy}
                          className="btn-secondary inline-flex items-center gap-1 h-8 px-2.5 text-[12px] disabled:opacity-40"
                          title="View activity log">
                          <ListChecks className="h-3.5 w-3.5" /> Activity
                        </button>
                        {/*
                          0075 — "Skip next lock" (one-shot, admin-only).
                          When clicked, the very next hourly period-lock
                          that would fire for this manager is suppressed
                          (the boundary advances by one; the period after
                          locks normally). Works offline-safe — the flag
                          lives on the session row.
                          Armed visually = amber pill (server confirms via
                          skip_next_period_lock on the row).
                        */}
                        <button type="button" onClick={() => void runSkipNext(r)}
                          disabled={isBusy || !r.session_id}
                          className={
                            'inline-flex items-center gap-1 h-8 px-2.5 text-[12px] rounded-base disabled:opacity-40 ' +
                            (r.skip_next_period_lock
                              ? 'bg-amber-900/40 text-amber-100 border border-amber-700/40'
                              : 'btn-secondary')
                          }
                          title={r.skip_next_period_lock
                            ? 'Next period-lock is ARMED to skip. Clicking again keeps it armed.'
                            : 'Skip this manager\'s next hourly period-lock (one shot)'}>
                          <SkipForward className="h-3.5 w-3.5" />
                          {r.skip_next_period_lock ? 'Skip armed' : 'Skip next lock'}
                        </button>
                        <button type="button" onClick={() => void runRearm(r)} disabled={isBusy || !r.session_id}
                          className="btn-secondary inline-flex items-center gap-1 h-8 px-2.5 text-[12px] disabled:opacity-40"
                          title="Re-arm — reset timer fresh">
                          <RotateCcw className="h-3.5 w-3.5" /> Re-arm
                        </button>
                        {status !== 'completed' && status !== 'not_started' && (
                          <button type="button" onClick={() => void runForceEnd(r)} disabled={isBusy || !r.session_id}
                            className="btn-secondary inline-flex items-center gap-1 h-8 px-2.5 text-[12px] disabled:opacity-40"
                            title="Force end — mark session completed now (may set early_end_flag)">
                            <Square className="h-3.5 w-3.5" /> End
                          </button>
                        )}
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

      {/* Per-user activity-log drawer (read-only). */}
      <UserActivityPanel
        open={!!activityRow}
        userId={activityRow?.user_id ?? null}
        userLabel={activityRow?.full_name ?? activityRow?.username ?? ''}
        onClose={() => setActivityRow(null)}
      />

      {/*
        0067 — pending bio-break approval queue REMOVED. Bio break is
        now a hard limit (server cap = config.bio_break_max_per_day;
        admin grants no longer add to the max). The bio_break_requests
        table + RPCs remain in the DB but the manager UI no longer
        creates new requests, so no rows reach the admin panel.
      */}
    </section>
  );
}

// 0067 — BioRequestsQueue sub-component fully removed.
//   It rendered the pending bio_break_requests queue with Approve / Deny
//   actions. Now that bio break is a HARD limit (no admin-request escape
//   hatch), no rows reach this surface. The bio_break_requests table +
//   useBioBreakPending / useBioBreakRequestDecide hooks + the underlying
//   RPCs all remain in the DB / shift.ts as inert legacy — only the
//   admin-panel render of this queue and its imports are removed here.
