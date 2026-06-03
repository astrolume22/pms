/**
 * P4.7 — Admin Shift Edit modal.
 *
 * Opens from the AdminShiftControlSection row's "Edit" button. Lets
 * the admin set EVERYTHING for one manager in one place:
 *   - Mode (easy/medium/hard) → drives period length (1h/3h/4h)
 *   - Primary group (from that manager's ACL-visible groups)
 *   - Shift break length (minutes)
 *   - Bio break limits (4 fields)
 *   - Per-weekday schedule (7 rows Sun-Sat, enabled + hours)
 *
 * Save:
 *   1. shift_admin_set_config with all config fields.
 *   2. shift_admin_set_schedule per weekday (RPC is idempotent for
 *      unchanged rows — emits an audit event only on real change).
 *
 * Existing active session keeps its snapshot per the 0057 design.
 * Surface that explicitly so admins know changes apply to the NEXT
 * shift / next period.
 */
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Save } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/Spinner';
import {
  useAdminShiftSchedules,
  useShiftAdminSetConfig,
  useShiftAdminSetSchedule,
  useUserVisibleGroups,
  type AdminShiftRow,
  type ShiftMode,
} from '@/hooks/shift';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface AdminShiftEditModalProps {
  row: AdminShiftRow;
  open: boolean;
  onClose: () => void;
}

interface DayState { weekday: number; enabled: boolean; hours: number }

export function AdminShiftEditModal({ row, open, onClose }: AdminShiftEditModalProps) {
  const { data: schedules, isLoading: schedLoading } = useAdminShiftSchedules(row.user_id, open);
  const { data: groups, isLoading: groupsLoading } = useUserVisibleGroups(row.user_id, open);
  const setConfig   = useShiftAdminSetConfig();
  const setSchedule = useShiftAdminSetSchedule();

  // Local form state — initialised from props/queries when the modal
  // opens, persisted while the user edits.
  const [mode, setMode]               = useState<ShiftMode>(row.mode ?? 'medium');
  const [primaryGroupId, setPGI]      = useState<string | null>(row.primary_group_id);
  const [shiftBreakMin, setSBMin]     = useState<number>(Math.round((row.shift_break_seconds ?? 3600) / 60));
  const [bioMax, setBioMax]           = useState<number>(row.bio_break_max_per_day ?? 7);
  const [bioWarn, setBioWarn]         = useState<number>(row.bio_break_warn_count ?? 6);
  const [bioWarnTotal, setBWT]        = useState<number>(Math.round((row.bio_break_warn_total_seconds ?? 3600) / 60));
  const [bioMaxEach, setBME]          = useState<number>(Math.round((row.bio_break_max_seconds_each ?? 900) / 60));
  const [days, setDays]               = useState<DayState[]>([]);
  const [submitting, setSubmitting]   = useState(false);

  // Reset form whenever the modal opens with new row/schedule data.
  useEffect(() => {
    if (!open) return;
    setMode(row.mode ?? 'medium');
    setPGI(row.primary_group_id);
    setSBMin(Math.round((row.shift_break_seconds ?? 3600) / 60));
    setBioMax(row.bio_break_max_per_day ?? 7);
    setBioWarn(row.bio_break_warn_count ?? 6);
    setBWT(Math.round((row.bio_break_warn_total_seconds ?? 3600) / 60));
    setBME(Math.round((row.bio_break_max_seconds_each ?? 900) / 60));
  }, [open, row]);
  useEffect(() => {
    if (!schedules) return;
    // Build 7 days with current values; missing days default to 8h disabled.
    const byWd = new Map(schedules.map((s) => [s.weekday, s] as const));
    setDays(Array.from({ length: 7 }, (_, wd) => {
      const r = byWd.get(wd);
      return {
        weekday: wd,
        enabled: r?.enabled ?? false,
        hours:   Math.round(((r?.required_seconds ?? 28800)) / 3600),
      };
    }));
  }, [schedules]);

  const periodHint = useMemo(() => {
    if (mode === 'easy')   return 'Lock every 4 hours';
    if (mode === 'medium') return 'Lock every 3 hours';
    return 'Lock every 1 hour';
  }, [mode]);

  const handleSave = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await setConfig.mutateAsync({
        target_user_id:               row.user_id,
        mode,
        shift_break_seconds:          shiftBreakMin * 60,
        bio_break_max_per_day:        bioMax,
        bio_break_warn_count:         bioWarn,
        bio_break_warn_total_seconds: bioWarnTotal * 60,
        bio_break_max_seconds_each:   bioMaxEach * 60,
        primary_group_id:             primaryGroupId,
      });
      // Send all 7 days — server RPC is idempotent for no-ops.
      await Promise.all(days.map((d) =>
        setSchedule.mutateAsync({
          target_user_id:   row.user_id,
          weekday:          d.weekday,
          enabled:          d.enabled,
          required_seconds: d.hours * 3600,
        })
      ));
      toast.success(`Saved settings for ${row.full_name ?? row.username}. Changes take effect on the next shift / next period.`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => { if (!submitting) onClose(); }}
      title={`Shift settings — ${row.full_name ?? row.username}`}
      size="lg"
    >
      <div className="space-y-5">
        <p className="text-[12px] text-text-secondary">
          Changes apply to the manager&apos;s NEXT shift and to the next period
          (the current active session keeps its snapshot of mode / hours / break
          limits taken at start time).
        </p>

        <section className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="text-[12px] font-semibold uppercase tracking-wide text-text-secondary">Mode</span>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as ShiftMode)}
              className="mt-1 w-full h-10 px-3 rounded-base bg-canvas border border-border-light text-text-primary"
            >
              <option value="easy">Easy — lock every 4 h</option>
              <option value="medium">Medium — lock every 3 h (default)</option>
              <option value="hard">Hard — lock every 1 h</option>
            </select>
            <span className="text-[11px] text-text-secondary mt-0.5 block">{periodHint}</span>
          </label>

          <label className="block">
            <span className="text-[12px] font-semibold uppercase tracking-wide text-text-secondary">Primary group</span>
            <select
              value={primaryGroupId ?? ''}
              onChange={(e) => setPGI(e.target.value || null)}
              disabled={groupsLoading}
              className="mt-1 w-full h-10 px-3 rounded-base bg-canvas border border-border-light text-text-primary"
            >
              <option value="">— none —</option>
              {(groups ?? []).map((g) => (
                <option key={g.id} value={g.id}>{g.board_name}: {g.name}</option>
              ))}
            </select>
            <span className="text-[11px] text-text-secondary mt-0.5 block">
              {groupsLoading ? 'Loading…' : `${(groups ?? []).length} group(s) granted via Group Access`}
            </span>
          </label>
        </section>

        <section>
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-text-secondary mb-2">Breaks</h3>
          <div className="grid grid-cols-2 gap-4">
            <NumberField label="Shift break (minutes)" value={shiftBreakMin} setValue={setSBMin} min={1} max={240} />
            <NumberField label="Bio break — max per day" value={bioMax} setValue={setBioMax} min={1} max={20} />
            <NumberField label="Bio break — warn count" value={bioWarn} setValue={setBioWarn} min={0} max={20} />
            <NumberField label="Bio break — warn at total (min)" value={bioWarnTotal} setValue={setBWT} min={0} max={480} />
            <NumberField label="Bio break — max minutes each" value={bioMaxEach} setValue={setBME} min={1} max={60} />
          </div>
        </section>

        <section>
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-text-secondary mb-2">Weekly schedule</h3>
          {schedLoading ? (
            <div className="flex justify-center py-6"><Spinner className="h-5 w-5 text-brand" /></div>
          ) : (
            <ul className="divide-y divide-border-hair">
              {days.map((d, idx) => (
                <li key={d.weekday} className="flex items-center gap-3 py-2">
                  <label className="inline-flex items-center gap-2 w-20">
                    <input
                      type="checkbox"
                      checked={d.enabled}
                      onChange={(e) => setDays((arr) => arr.map((x, i) => i === idx ? { ...x, enabled: e.target.checked } : x))}
                      className="h-4 w-4 accent-brand cursor-pointer"
                    />
                    <span className="text-sm">{DAY_LABELS[d.weekday]}</span>
                  </label>
                  <div className="flex items-center gap-2 ml-auto">
                    <span className="text-[12px] text-text-secondary">Hours</span>
                    <input
                      type="number"
                      min={0}
                      max={24}
                      value={d.hours}
                      disabled={!d.enabled}
                      onChange={(e) => setDays((arr) => arr.map((x, i) => i === idx ? { ...x, hours: Math.max(0, Math.min(24, parseInt(e.target.value || '0', 10) || 0)) } : x))}
                      className="w-16 h-9 px-2 rounded-base bg-canvas border border-border-light text-text-primary disabled:opacity-40"
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border-light">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="btn-secondary h-9 px-4"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={submitting}
            className="btn-primary h-9 px-4 inline-flex items-center gap-2 disabled:opacity-60"
          >
            <Save className="h-4 w-4" />
            {submitting ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function NumberField({ label, value, setValue, min, max }:
    { label: string; value: number; setValue: (n: number) => void; min: number; max: number }) {
  return (
    <label className="block">
      <span className="text-[12px] text-text-secondary">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => setValue(Math.max(min, Math.min(max, parseInt(e.target.value || '0', 10) || 0)))}
        className="mt-1 w-full h-9 px-3 rounded-base bg-canvas border border-border-light text-text-primary"
      />
    </label>
  );
}
