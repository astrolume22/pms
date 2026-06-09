/**
 * Right-side activity-log drawer for the admin Shift Control panel.
 *
 * Read-only. Renders a target user's recent shift_events (newest first)
 * with human-friendly labels + meta detail. No actions, no edits, no
 * deletes. Reads via useUserShiftActivity which is gated on `open` so
 * the query only fires when the drawer is mounted+open.
 *
 * Premium dark theme — navy panel + gold accent, Inter typography.
 * Close on X / ESC / scrim click. Fixed right side, 420px wide,
 * full-height, scrollable content area.
 */
import { useEffect } from 'react';
import { X } from 'lucide-react';
import { Spinner } from '@/components/Spinner';
import { useUserShiftActivity, type ShiftActivityRow } from '@/hooks/shift';

const EIA_NAVY = '#0F1E36';
const EIA_GOLD = '#E1B978';

interface Props {
  open: boolean;
  userId: string | null;
  userLabel: string;
  onClose: () => void;
}

export function UserActivityPanel({ open, userId, userLabel, onClose }: Props) {
  const { data, isLoading, error } = useUserShiftActivity(userId ?? undefined, open && !!userId);

  // ESC closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Scrim — click to dismiss. */}
      <div
        className="fixed inset-0 z-[90]"
        style={{ background: 'rgba(15, 30, 54, 0.55)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
        aria-hidden
      />
      {/* Drawer. */}
      <aside
        className="fixed top-0 right-0 z-[91] h-full w-[420px] flex flex-col shadow-2xl"
        style={{
          background: EIA_NAVY,
          borderLeft: `1px solid ${EIA_GOLD}44`,
          fontFamily: '"Inter", system-ui, sans-serif',
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-activity-heading"
      >
        {/* Header */}
        <header
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: `1px solid ${EIA_GOLD}22` }}
        >
          <div className="flex flex-col">
            <h2
              id="user-activity-heading"
              className="text-[18px] leading-tight m-0"
              style={{ fontWeight: 600, color: EIA_GOLD, letterSpacing: '0.01em' }}
            >
              {userLabel}
            </h2>
            <p
              className="text-[11px] m-0"
              style={{ color: 'rgba(255,255,255,0.55)', letterSpacing: '0.04em', textTransform: 'uppercase' }}
            >
              Activity log
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 transition focus:outline-none focus:ring-2"
            style={{ color: 'rgba(255,255,255,0.65)' }}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner className="h-5 w-5 text-amber-300" />
            </div>
          ) : error ? (
            <div className="px-5 py-8 text-[12.5px]" style={{ color: 'rgba(255,255,255,0.7)' }}>
              Couldn't load activity: {error instanceof Error ? error.message : 'unknown error'}
            </div>
          ) : !data || data.length === 0 ? (
            <div className="px-5 py-12 text-[13px] text-center" style={{ color: 'rgba(255,255,255,0.6)' }}>
              No activity yet.
            </div>
          ) : (
            <ActivityList rows={data} />
          )}
        </div>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------
function ActivityList({ rows }: { rows: ShiftActivityRow[] }) {
  // Group by local date (YYYY-MM-DD) for a small day divider.
  const groups: { day: string; rows: ShiftActivityRow[] }[] = [];
  let currentDay = '';
  for (const r of rows) {
    const day = dayKey(r.at);
    if (day !== currentDay) {
      groups.push({ day, rows: [] });
      currentDay = day;
    }
    groups[groups.length - 1].rows.push(r);
  }
  return (
    <ul className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
      {groups.map((g) => (
        <li key={g.day} className="block">
          <div
            className="sticky top-0 px-5 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide"
            style={{
              background: EIA_NAVY,
              borderBottom: `1px solid ${EIA_GOLD}11`,
              color: 'rgba(255,255,255,0.5)',
              letterSpacing: '0.06em',
            }}
          >
            {formatDay(g.day)}
          </div>
          <ul className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
            {g.rows.map((r) => (
              <ActivityRow key={r.id} row={r} />
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function ActivityRow({ row }: { row: ShiftActivityRow }) {
  const { label, detail } = describeEvent(row);
  return (
    <li className="px-5 py-2.5 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] m-0" style={{ color: 'rgba(255,255,255,0.92)' }}>
          {label}
        </p>
        {detail && (
          <p
            className="text-[11px] m-0 mt-0.5"
            style={{ color: 'rgba(255,255,255,0.55)', lineHeight: 1.45 }}
          >
            {detail}
          </p>
        )}
      </div>
      <time
        dateTime={row.at}
        className="text-[10.5px] tabular-nums flex-shrink-0 mt-0.5"
        style={{ color: 'rgba(255,255,255,0.45)', letterSpacing: '0.02em' }}
      >
        {formatTime(row.at)}
      </time>
    </li>
  );
}

// =====================================================================
// Event → human label + meta detail
// Built from the LIVE event-type CHECK + observed meta keys (PHASE 0):
//   shift_start / shift_complete
//   shift_break_start / shift_break_end
//   bio_break_start / bio_break_end / bio_break_auto_end
//   period_lock / period_unlock / period_85_alert
//   shift_break_overstay_freeze / shift_break_overstay_lock
//   admin_override (meta.action: account_lock | account_unlock | rearm |
//                   account_lock_pause | account_unlock_resume |
//                   break_overstay_unfreeze)
//   bio_break_request / bio_break_request_decided
//   late_start / early_end
// Any future event type falls through to a humanized fallback with the
// meta serialized so nothing is hidden from the admin.
// =====================================================================
function describeEvent(row: ShiftActivityRow): { label: string; detail: string | null } {
  const meta = (row.meta ?? {}) as Record<string, unknown>;
  switch (row.type) {
    case 'shift_start': {
      const late = meta.late_start_flag === true ? ` · late ${formatMinutes(meta.minutes_late)}` : '';
      return { label: 'Shift started', detail: late || null };
    }
    case 'shift_complete':
      return { label: 'Shift completed', detail: null };

    case 'shift_break_start':
      return { label: 'Shift break started', detail: null };

    case 'shift_break_end': {
      const recorded = numOr(meta.duration_seconds_recorded, null);
      const actual   = numOr(meta.duration_seconds_actual,   null);
      const overstay = numOr(meta.overstay_seconds,          0);
      const ended_by = typeof meta.ended_by === 'string' ? meta.ended_by : null;
      const parts: string[] = [];
      if (recorded !== null) parts.push(formatDuration(recorded));
      if (overstay > 0) parts.push('overstayed ' + formatDuration(overstay));
      if (actual !== null && recorded !== null && actual > recorded) {
        parts.push('actual ' + formatDuration(actual));
      }
      if (ended_by === 'overstay_lock') parts.push('ended by lock');
      return {
        label: 'Shift break ended',
        detail: parts.length ? parts.join(' · ') : null,
      };
    }

    case 'bio_break_start':
      return {
        label: 'Bio break started',
        detail: meta.count_so_far !== undefined ? '#' + numOr(meta.count_so_far, 0) + ' today' : null,
      };

    case 'bio_break_end':
    case 'bio_break_auto_end': {
      const recorded = numOr(meta.duration_seconds_recorded, null);
      const actual   = numOr(meta.duration_seconds_actual,   null);
      const exceeded = meta.exceeded_cap === true;
      const parts: string[] = [];
      if (recorded !== null) parts.push(formatDuration(recorded));
      if (exceeded && actual !== null && actual > (recorded ?? 0)) {
        parts.push('capped from ' + formatDuration(actual));
      }
      if (row.type === 'bio_break_auto_end') parts.push('auto-ended at 15:00');
      return { label: 'Bio break ended', detail: parts.length ? parts.join(' · ') : null };
    }

    case 'period_lock':
      return {
        label: 'Auto-locked (hourly checkpoint)',
        detail: meta.period_index !== undefined ? 'period ' + numOr(meta.period_index, 0) : null,
      };
    case 'period_unlock': {
      const dur = numOr(meta.pause_seconds, 0);
      return {
        label: 'Unlocked by admin',
        detail: dur > 0 ? 'paused for ' + formatDuration(dur) : null,
      };
    }
    case 'period_85_alert':
      return { label: 'Check-in warning (85%)', detail: null };

    case 'shift_break_overstay_freeze': {
      const elapsed = numOr(meta.break_elapsed_seconds, 0);
      const allowance = numOr(meta.allowance_seconds, 1800);
      return {
        label: 'Break overstay — timer frozen',
        detail: 'at ' + formatDuration(elapsed) + ' (allowance ' + formatDuration(allowance) + ')',
      };
    }
    case 'shift_break_overstay_lock': {
      const elapsed = numOr(meta.break_elapsed_seconds, 0);
      const allowance = numOr(meta.allowance_seconds, 1800);
      const grace = numOr(meta.grace_seconds, 900);
      return {
        label: 'Locked (break exceeded)',
        detail: 'after ' + formatDuration(elapsed)
              + ' (allowance ' + formatDuration(allowance)
              + ' + grace ' + formatDuration(grace) + ')',
      };
    }

    case 'admin_override': {
      const action = typeof meta.action === 'string' ? meta.action : 'override';
      const map: Record<string, string> = {
        account_lock:           'Account locked by admin',
        account_unlock:         'Account unlocked by admin',
        rearm:                  'Re-armed by admin',
        account_lock_pause:     'Account lock — session paused',
        account_unlock_resume:  'Account unlock — session resumed',
        break_overstay_unfreeze:'Break-overstay freeze cleared',
      };
      const label = map[action] ?? 'Admin override: ' + action;
      let detail: string | null = null;
      if (typeof meta.pause_seconds === 'number') detail = 'paused ' + formatDuration(meta.pause_seconds);
      else if (typeof meta.paused_seconds === 'number') detail = 'paused ' + formatDuration(meta.paused_seconds);
      return { label, detail };
    }

    case 'bio_break_request':
      return { label: 'Bio break — requested admin', detail: null };
    case 'bio_break_request_decided': {
      const s = typeof meta.decision === 'string' ? meta.decision
              : typeof meta.status   === 'string' ? meta.status
              : 'decided';
      return { label: 'Bio break — admin ' + s, detail: null };
    }

    case 'late_start': {
      const mins = numOr(meta.minutes_late, 0);
      return { label: 'Late start', detail: mins > 0 ? mins + ' min late' : null };
    }
    case 'early_end': {
      const mins = numOr(meta.minutes_early, 0);
      return { label: 'Early end', detail: mins > 0 ? mins + ' min early' : null };
    }

    default: {
      // Fallback: humanize underscores, dump meta if any.
      const label = row.type.replace(/_/g, ' ');
      const detail = Object.keys(meta).length > 0 ? JSON.stringify(meta) : null;
      return { label, detail };
    }
  }
}

function numOr<T>(v: unknown, fallback: T): number | T {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function formatMinutes(v: unknown): string {
  return typeof v === 'number' ? v + ' min' : '';
}

function formatDuration(sec: number): string {
  const v = Math.max(0, Math.floor(sec));
  if (v < 60) return v + 's';
  const m = Math.floor(v / 60);
  const s = v % 60;
  return s === 0 ? m + 'm' : m + 'm ' + s + 's';
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}

function formatDay(key: string): string {
  // Today / Yesterday / "Jun 9, 2026"
  const [y, m, d] = key.split('-').map(Number);
  const that = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (that.getTime() === today.getTime()) return 'Today';
  if (that.getTime() === yesterday.getTime()) return 'Yesterday';
  return that.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
