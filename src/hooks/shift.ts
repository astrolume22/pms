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

// Live computed payload returned by shift_tick (jsonb).
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
  current_period_end_seconds: number;
  period_85_due: boolean;
  period_lock_due: boolean;
  bio_break_count_today: number;
  bio_break_total_seconds_today: number;
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
// useShiftAdminUnlock — admin-only RPC, server-side is_admin() gate.
// ---------------------------------------------------------------------
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
