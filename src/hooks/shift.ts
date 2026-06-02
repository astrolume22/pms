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
