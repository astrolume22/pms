/**
 * P4.2 — Shift system hooks (read-only + start RPC).
 *
 * The server (migration 0057) is the source of truth for every time
 * value here. The client polls `shift_tick` every ~10s and interpolates
 * 1/sec locally between polls — but it NEVER persists a timer to local
 * storage. A refresh / refocus / clock-change immediately snaps back to
 * the server-computed remaining_seconds, so users cannot steal time by
 * fiddling with the page.
 *
 * Higher phases (P4.3+) add lock / break / admin mutations on top of
 * the skeleton RPCs already shipped in 0057.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/state/authStore';

export type ShiftStatus =
  | 'not_started'
  | 'active'
  | 'on_shift_break'
  | 'on_bio_break'
  | 'locked'
  | 'completed';

export type ShiftMode = 'easy' | 'medium' | 'hard';

// Row returned by shift_get_or_create_today_session (composite of
// public.shift_sessions, serialized as JSON by PostgREST).
export interface ShiftSessionRow {
  id: string;
  user_id: string;
  work_date: string;
  status: ShiftStatus;
  mode: ShiftMode;
  period_seconds: number;
  required_seconds: number;
  started_at: string | null;
  paused_total_seconds: number;
  current_pause_started_at: string | null;
  current_pause_reason: 'period_lock' | 'admin' | null;
  current_period_index: number;
  period_85_last_index_alerted: number;
  locked_at: string | null;
  locked_reason: 'period_lock' | 'shift_complete' | 'admin' | 'bio_request' | null;
  locked_by: string | null;
  bio_break_count_today: number;
  bio_break_total_seconds_today: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

// Live computed payload returned by shift_tick (jsonb). Widened by
// migration 0060 to expose break state + bio config + computed flags.
export interface ShiftTickPayload {
  session_id: string;
  user_id: string;
  status: ShiftStatus;
  started_at: string | null;
  work_date: string;
  mode: ShiftMode;
  period_seconds: number;
  required_seconds: number;
  elapsed_seconds: number;
  remaining_seconds: number;
  paused_total_seconds: number;
  current_period_index: number;
  current_period_start_seconds?: number;
  current_period_end_seconds: number;
  period_85_threshold_seconds?: number;
  period_85_due: boolean;
  period_lock_due: boolean;
  // Break state (P4.4)
  current_break_kind: 'shift' | 'bio' | null;
  current_break_started_at: string | null;
  current_break_elapsed_seconds: number;
  // Bio counters + config (P4.4)
  bio_break_count_today: number;
  bio_break_total_seconds_today: number;
  bio_break_admin_grants_today: number;
  bio_break_max_per_day: number | null;
  bio_break_warn_count: number | null;
  bio_break_warn_total_seconds: number | null;
  bio_break_max_seconds_each: number | null;
  bio_limit_reached: boolean;
  locked_at: string | null;
  locked_reason: ShiftSessionRow['locked_reason'];
  completed_at: string | null;
  now: string;
}

export const shiftKeys = {
  all:   ['shift'] as const,
  today: (uid: string) => [...shiftKeys.all, 'today', uid] as const,
  tick:  (sessionId: string) => [...shiftKeys.all, 'tick', sessionId] as const,
};

// ---------------------------------------------------------------------
// useTodayShiftSession — one call per mount; the daily-reset / lazy-
// create happens server-side in shift_get_or_create_today_session().
// Pass enabled=isManager so admins/super never touch the shift tables.
// ---------------------------------------------------------------------
export function useTodayShiftSession(enabled: boolean) {
  const userId = useAuthStore((s) => s.profile?.id);
  return useQuery<ShiftSessionRow>({
    queryKey: userId ? shiftKeys.today(userId) : [...shiftKeys.all, 'today', '_'],
    enabled: enabled && !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('shift_get_or_create_today_session');
      if (error) throw error;
      return data as ShiftSessionRow;
    },
    // Fresh on mount so a page refresh immediately re-syncs.
    staleTime: 0,
    refetchOnWindowFocus: false, // refresh-on-401 layer + warm-up handle this
  });
}

// ---------------------------------------------------------------------
// useShiftStart — RPC mutation. Optimistically flips the cached
// session to status='active' so the gate hides instantly; the
// invalidate-driven refetch confirms moments later.
// ---------------------------------------------------------------------
export function useShiftStart() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.profile?.id);
  return useMutation({
    mutationFn: async (): Promise<{ session_id: string; started_at: string }> => {
      const { data, error } = await supabase.rpc('shift_start');
      if (error) throw error;
      return data as { session_id: string; started_at: string };
    },
    onSuccess: (payload) => {
      if (userId) {
        qc.setQueryData<ShiftSessionRow | undefined>(
          shiftKeys.today(userId),
          (prev) => prev ? { ...prev, status: 'active', started_at: payload.started_at } : prev,
        );
      }
      void qc.invalidateQueries({ queryKey: shiftKeys.all });
    },
  });
}

// ---------------------------------------------------------------------
// useShiftTick — polls the read-only RPC every 10s. The component
// using this is responsible for the 1/sec local interpolation.
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// useShiftSelfPeriodLock — manager-callable (idempotent) when tick says
// period_lock_due. Server-time gated by the RPC itself.
// ---------------------------------------------------------------------
export function useShiftSelfPeriodLock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const { data, error } = await supabase.rpc('shift_self_period_lock', { p_session_id: sessionId });
      if (error) throw error;
      return data as { session_id: string; status: ShiftStatus; already_locked: boolean };
    },
    onSuccess: (_data, sessionId) => {
      void qc.invalidateQueries({ queryKey: shiftKeys.all });
      void sessionId;
    },
  });
}

// ---------------------------------------------------------------------
// useShiftMark85Alerted — manager-callable; flips period_85_due to
// false for the current period so the toast never re-fires.
// ---------------------------------------------------------------------
export function useShiftMark85Alerted() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const { data, error } = await supabase.rpc('shift_mark_85_alerted', { p_session_id: sessionId });
      if (error) throw error;
      return data as { session_id: string; already_alerted: boolean; period_index?: number };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: shiftKeys.all });
    },
  });
}

// ---------------------------------------------------------------------
// Admin-only shift RPCs (P4.7). Server-side is_admin() is the truth
// gate; the UI hides these buttons for non-admins as a UX layer.
// ---------------------------------------------------------------------
export function useShiftAdminLock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { sessionId: string; reason: 'period_lock' | 'shift_complete' | 'admin' | 'bio_request' }) => {
      const { data, error } = await supabase.rpc('shift_admin_lock', {
        p_session_id: args.sessionId, p_reason: args.reason,
      });
      if (error) throw error;
      return data as { session_id: string; status: ShiftStatus };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'shift-control'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'locked-shifts'] });
    },
  });
}

export function useShiftAdminRearm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const { data, error } = await supabase.rpc('shift_admin_rearm', { p_session_id: sessionId });
      if (error) throw error;
      return data as { session_id: string; status: ShiftStatus };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'shift-control'] });
    },
  });
}

export interface AdminSetConfigInput {
  target_user_id: string;
  mode: ShiftMode;
  shift_break_seconds: number;
  bio_break_max_per_day: number;
  bio_break_warn_count: number;
  bio_break_warn_total_seconds: number;
  bio_break_max_seconds_each: number;
  primary_group_id: string | null;
}
export function useShiftAdminSetConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AdminSetConfigInput) => {
      const { data, error } = await supabase.rpc('shift_admin_set_config', {
        p_target_user_id:               input.target_user_id,
        p_mode:                         input.mode,
        p_shift_break_seconds:          input.shift_break_seconds,
        p_bio_break_max_per_day:        input.bio_break_max_per_day,
        p_bio_break_warn_count:         input.bio_break_warn_count,
        p_bio_break_warn_total_seconds: input.bio_break_warn_total_seconds,
        p_bio_break_max_seconds_each:   input.bio_break_max_seconds_each,
        p_primary_group_id:             input.primary_group_id,
      });
      if (error) throw error;
      return data as { user_id: string; existed_before: boolean };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'shift-control'] });
    },
  });
}

export function useShiftAdminSetSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { target_user_id: string; weekday: number; enabled: boolean; required_seconds: number }) => {
      const { data, error } = await supabase.rpc('shift_admin_set_schedule', {
        p_target_user_id:   input.target_user_id,
        p_weekday:          input.weekday,
        p_enabled:          input.enabled,
        p_required_seconds: input.required_seconds,
      });
      if (error) throw error;
      return data as { user_id: string; weekday: number; changed: boolean };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'shift-control'] });
    },
  });
}

// ---------------------------------------------------------------------
// useAdminShiftControl — the unified per-manager view that powers the
// /admin → Shift Control panel. Returns one row per active manager
// joining users + shift_configs + today's shift_sessions + primary
// group name. Polled every 10s so live status (active / locked /
// break / completed) stays current. Admin RLS already grants SELECT
// on all three tables to is_admin().
// ---------------------------------------------------------------------
export interface AdminShiftRow {
  user_id: string;
  full_name: string | null;
  username: string;
  email: string;
  // Config (may be null if config row missing — rare; will create on
  // first save).
  mode: ShiftMode | null;
  shift_break_seconds: number | null;
  bio_break_max_per_day: number | null;
  bio_break_warn_count: number | null;
  bio_break_warn_total_seconds: number | null;
  bio_break_max_seconds_each: number | null;
  primary_group_id: string | null;
  primary_group_name: string | null;
  // Today's session (may be null if not_started not yet created).
  session_id: string | null;
  status: ShiftStatus | null;
  session_required_seconds: number | null;
  session_started_at: string | null;
  session_paused_total_seconds: number | null;
  session_current_pause_started_at: string | null;
  session_locked_reason: string | null;
  session_bio_break_count_today: number | null;
}
export function useAdminShiftControl(enabled: boolean) {
  return useQuery<AdminShiftRow[]>({
    queryKey: ['admin', 'shift-control'],
    enabled,
    queryFn: async () => {
      const todayUTC = new Date().toISOString().slice(0, 10);
      // Three small parallel queries — RLS lets admins read everything.
      const [usersRes, cfgRes, sessRes] = await Promise.all([
        supabase.from('users').select('id, full_name, username, email, role, status, is_super_admin').eq('role', 'manager').eq('status', 'active').eq('is_super_admin', false),
        supabase.from('shift_configs').select('user_id, mode, shift_break_seconds, bio_break_max_per_day, bio_break_warn_count, bio_break_warn_total_seconds, bio_break_max_seconds_each, primary_group_id'),
        supabase.from('shift_sessions').select('id, user_id, status, required_seconds, started_at, paused_total_seconds, current_pause_started_at, locked_reason, bio_break_count_today').eq('work_date', todayUTC),
      ]);
      if (usersRes.error) throw usersRes.error;
      if (cfgRes.error)  throw cfgRes.error;
      if (sessRes.error) throw sessRes.error;

      type CfgRow = { user_id: string; mode: ShiftMode; shift_break_seconds: number;
        bio_break_max_per_day: number; bio_break_warn_count: number;
        bio_break_warn_total_seconds: number; bio_break_max_seconds_each: number;
        primary_group_id: string | null };
      type SessRow = { id: string; user_id: string; status: ShiftStatus; required_seconds: number;
        started_at: string | null; paused_total_seconds: number;
        current_pause_started_at: string | null; locked_reason: string | null;
        bio_break_count_today: number };
      const cfgByUser  = new Map<string, CfgRow>((cfgRes.data ?? []).map((r) => [r.user_id, r as CfgRow]));
      const sessByUser = new Map<string, SessRow>((sessRes.data ?? []).map((r) => [r.user_id, r as SessRow]));

      // Collect primary_group_ids → fetch group names in one go.
      const groupIds = Array.from(new Set(
        ((cfgRes.data ?? []) as CfgRow[]).map((c) => c.primary_group_id).filter(Boolean) as string[]
      ));
      let groupNames = new Map<string, string>();
      if (groupIds.length > 0) {
        const { data: groups, error: gErr } = await supabase.from('groups').select('id, name').in('id', groupIds);
        if (gErr) throw gErr;
        groupNames = new Map((groups ?? []).map((g) => [g.id as string, g.name as string]));
      }

      return (usersRes.data ?? []).map((u) => {
        const cfg = cfgByUser.get(u.id as string);
        const s   = sessByUser.get(u.id as string);
        return {
          user_id: u.id as string,
          full_name: (u.full_name ?? null) as string | null,
          username: u.username as string,
          email: u.email as string,
          mode:                         cfg?.mode                          ?? null,
          shift_break_seconds:          cfg?.shift_break_seconds           ?? null,
          bio_break_max_per_day:        cfg?.bio_break_max_per_day         ?? null,
          bio_break_warn_count:         cfg?.bio_break_warn_count          ?? null,
          bio_break_warn_total_seconds: cfg?.bio_break_warn_total_seconds  ?? null,
          bio_break_max_seconds_each:   cfg?.bio_break_max_seconds_each    ?? null,
          primary_group_id:             cfg?.primary_group_id              ?? null,
          primary_group_name:           cfg?.primary_group_id ? (groupNames.get(cfg.primary_group_id) ?? null) : null,
          session_id:                       s?.id                          ?? null,
          status:                           s?.status                      ?? null,
          session_required_seconds:         s?.required_seconds            ?? null,
          session_started_at:               s?.started_at                  ?? null,
          session_paused_total_seconds:     s?.paused_total_seconds        ?? null,
          session_current_pause_started_at: s?.current_pause_started_at    ?? null,
          session_locked_reason:            s?.locked_reason               ?? null,
          session_bio_break_count_today:    s?.bio_break_count_today       ?? null,
        };
      }).sort((a, b) => (a.full_name ?? a.username).localeCompare(b.full_name ?? b.username));
    },
    refetchInterval: 10_000,
    refetchOnWindowFocus: false,
    staleTime: 0,
  });
}

// ---------------------------------------------------------------------
// useAdminShiftSchedules — load all shift_schedules rows for ONE user
// (admin opens the edit modal). 7 rows expected; sorted weekday 0→6.
// ---------------------------------------------------------------------
export interface AdminScheduleRow { user_id: string; weekday: number; enabled: boolean; required_seconds: number; }
export function useAdminShiftSchedules(userId: string | undefined, enabled: boolean) {
  return useQuery<AdminScheduleRow[]>({
    queryKey: userId ? ['admin', 'shift-schedules', userId] : ['admin', 'shift-schedules', '_'],
    enabled: enabled && !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shift_schedules')
        .select('user_id, weekday, enabled, required_seconds')
        .eq('user_id', userId!)
        .order('weekday', { ascending: true });
      if (error) throw error;
      return (data ?? []) as AdminScheduleRow[];
    },
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}

// ---------------------------------------------------------------------
// useUserVisibleGroups — for the admin edit modal's primary-group
// dropdown. Returns the groups a given user has been granted via
// group_user_visibility (Phase 3 ACL). Admin RLS lets is_admin() read
// every row.
// ---------------------------------------------------------------------
export interface VisibleGroupRow { id: string; name: string; color: string; board_id: string; board_name: string; }
export function useUserVisibleGroups(userId: string | undefined, enabled: boolean) {
  return useQuery<VisibleGroupRow[]>({
    queryKey: userId ? ['admin', 'user-visible-groups', userId] : ['admin', 'user-visible-groups', '_'],
    enabled: enabled && !!userId,
    queryFn: async () => {
      // Step 1: which groups can this user see?
      const { data: acl, error: aclErr } = await supabase
        .from('group_user_visibility').select('group_id').eq('user_id', userId!);
      if (aclErr) throw aclErr;
      const ids = (acl ?? []).map((r) => r.group_id as string);
      if (ids.length === 0) return [];
      // Step 2: group details + board name
      const { data: groups, error: gErr } = await supabase
        .from('groups').select('id, name, color, board_id, deleted_at').in('id', ids);
      if (gErr) throw gErr;
      const aliveGroups = (groups ?? []).filter((g) => !g.deleted_at);
      if (aliveGroups.length === 0) return [];
      const boardIds = Array.from(new Set(aliveGroups.map((g) => g.board_id as string)));
      const { data: boards, error: bErr } = await supabase
        .from('boards').select('id, name').in('id', boardIds);
      if (bErr) throw bErr;
      const boardName = new Map((boards ?? []).map((b) => [b.id as string, b.name as string]));
      return aliveGroups.map((g) => ({
        id: g.id as string,
        name: g.name as string,
        color: g.color as string,
        board_id: g.board_id as string,
        board_name: boardName.get(g.board_id as string) ?? '?',
      })).sort((a, b) => a.board_name.localeCompare(b.board_name) || a.name.localeCompare(b.name));
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useShiftAdminUnlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const { data, error } = await supabase.rpc('shift_admin_unlock', { p_session_id: sessionId });
      if (error) throw error;
      return data as { session_id: string; status: ShiftStatus; lock_wait_seconds: number };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: shiftKeys.all });
      // Also kick the admin's locked-shifts list so the row disappears.
      void qc.invalidateQueries({ queryKey: ['admin', 'locked-shifts'] });
    },
  });
}

// ---------------------------------------------------------------------
// useLockedShifts — admin Locked-Shifts queue. Polls every 10s so new
// locks land within the polling window. Filtered server-side to
// status='locked' (admin RLS lets is_admin() read all shift_sessions).
// ---------------------------------------------------------------------
export interface LockedShiftRow {
  id: string;
  user_id: string;
  locked_at: string;
  locked_reason: string;
  locked_by: string | null;
  full_name: string | null;
  username: string;
}
export function useLockedShifts(enabled: boolean) {
  return useQuery<LockedShiftRow[]>({
    queryKey: ['admin', 'locked-shifts'],
    enabled,
    queryFn: async () => {
      // Two-step: shift_sessions + users for the display name. Cheap
      // (locked shifts at any moment are rare).
      const { data: rows, error } = await supabase
        .from('shift_sessions')
        .select('id, user_id, locked_at, locked_reason, locked_by')
        .eq('status', 'locked')
        .order('locked_at', { ascending: true });
      if (error) throw error;
      const list = (rows ?? []) as Array<Pick<LockedShiftRow,'id'|'user_id'|'locked_at'|'locked_reason'|'locked_by'>>;
      if (list.length === 0) return [];
      const userIds = Array.from(new Set(list.map(r => r.user_id)));
      const { data: users, error: uErr } = await supabase
        .from('users').select('id, username, full_name').in('id', userIds);
      if (uErr) throw uErr;
      const byId = new Map((users ?? []).map(u => [u.id as string, u as { id: string; username: string; full_name: string | null }]));
      return list.map(r => ({
        ...r,
        full_name: byId.get(r.user_id)?.full_name ?? null,
        username:  byId.get(r.user_id)?.username  ?? '?',
      }));
    },
    refetchInterval: 10_000,
    refetchOnWindowFocus: false,
    staleTime: 0,
  });
}

// ---------------------------------------------------------------------
// P4.4 — break RPCs.  All three take session_id (post-0060). The RPCs
// enforce self-or-admin; the UI only exposes them to managers.
// ---------------------------------------------------------------------
export function useShiftTakeShiftBreak() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const { data, error } = await supabase.rpc('shift_take_shift_break', { p_session_id: sessionId });
      if (error) throw error;
      return data as { session_id: string; status: ShiftStatus };
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: shiftKeys.all }); },
  });
}

export function useShiftTakeBioBreak() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const { data, error } = await supabase.rpc('shift_take_bio_break', { p_session_id: sessionId });
      if (error) throw error;
      return data as {
        session_id: string; status: ShiftStatus;
        needs_request: boolean;
        count_today?: number; max_per_day?: number; admin_grants_today?: number;
      };
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: shiftKeys.all }); },
  });
}

export function useShiftEndBreak() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId: string) => {
      const { data, error } = await supabase.rpc('shift_end_break', { p_session_id: sessionId });
      if (error) throw error;
      return data as {
        session_id: string; status: ShiftStatus;
        kind: 'shift' | 'bio' | null;
        duration_seconds_actual: number;
        duration_seconds_recorded: number;
        exceeded_cap: boolean;
      };
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: shiftKeys.all }); },
  });
}

// ---------------------------------------------------------------------
// Bio break request lifecycle (manager creates, admin decides).
// ---------------------------------------------------------------------
export function useBioBreakRequestCreate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('bio_break_request_create');
      if (error) throw error;
      return data as { request_id: string; status: 'pending' };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: shiftKeys.all });
      void qc.invalidateQueries({ queryKey: ['admin', 'bio-requests'] });
    },
  });
}

export function useBioBreakRequestDecide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { requestId: string; decision: 'approved' | 'denied'; note?: string | null }) => {
      const { data, error } = await supabase.rpc('bio_break_request_decide', {
        p_request_id: args.requestId,
        p_decision:   args.decision,
        p_note:       args.note ?? null,
      });
      if (error) throw error;
      return data as { request_id: string; status: 'approved' | 'denied' };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'bio-requests'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'shift-control'] });
      void qc.invalidateQueries({ queryKey: shiftKeys.all });
    },
  });
}

// ---------------------------------------------------------------------
// Admin pending bio-break requests queue.
// ---------------------------------------------------------------------
export interface BioBreakRequestRow {
  id: string;
  session_id: string;
  user_id: string;
  requested_at: string;
  full_name: string | null;
  username: string;
}
export function useBioBreakPending(enabled: boolean) {
  return useQuery<BioBreakRequestRow[]>({
    queryKey: ['admin', 'bio-requests'],
    enabled,
    queryFn: async () => {
      const { data: reqs, error } = await supabase
        .from('bio_break_requests')
        .select('id, session_id, user_id, requested_at')
        .eq('status', 'pending')
        .order('requested_at', { ascending: true });
      if (error) throw error;
      const list = (reqs ?? []) as Array<Pick<BioBreakRequestRow,'id'|'session_id'|'user_id'|'requested_at'>>;
      if (list.length === 0) return [];
      const userIds = Array.from(new Set(list.map((r) => r.user_id)));
      const { data: users, error: uErr } = await supabase
        .from('users').select('id, username, full_name').in('id', userIds);
      if (uErr) throw uErr;
      const byId = new Map((users ?? []).map((u) => [u.id as string, u as { id: string; username: string; full_name: string | null }]));
      return list.map((r) => ({
        ...r,
        full_name: byId.get(r.user_id)?.full_name ?? null,
        username:  byId.get(r.user_id)?.username  ?? '?',
      }));
    },
    refetchInterval: 10_000,
    refetchOnWindowFocus: false,
    staleTime: 0,
  });
}

export function useShiftTick(sessionId: string | undefined, enabled: boolean) {
  return useQuery<ShiftTickPayload>({
    queryKey: sessionId ? shiftKeys.tick(sessionId) : [...shiftKeys.all, 'tick', '_'],
    enabled: enabled && !!sessionId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('shift_tick', { p_session_id: sessionId });
      if (error) throw error;
      return data as ShiftTickPayload;
    },
    refetchInterval: 10_000,
    // We rely on the visibility warm-up + refresh-on-401 layer; no
    // refocus-driven storm of ticks needed.
    refetchOnWindowFocus: false,
    staleTime: 0,
  });
}
