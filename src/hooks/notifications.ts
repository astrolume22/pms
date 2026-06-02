import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/state/authStore';
import type { NotificationRow } from '@/lib/database.types';

export const notificationKeys = {
  all: ['notifications'] as const,
  list: () => [...notificationKeys.all, 'list'] as const,
  unread: () => [...notificationKeys.all, 'unread'] as const,
};

export function useNotifications(limit = 50) {
  const userId = useAuthStore((s) => s.profile?.id);
  return useQuery({
    queryKey: [...notificationKeys.list(), limit],
    enabled: !!userId,
    queryFn: async (): Promise<NotificationRow[]> => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as NotificationRow[];
    },
  });
}

export function useUnreadCount() {
  const userId = useAuthStore((s) => s.profile?.id);
  return useQuery({
    queryKey: notificationKeys.unread(),
    enabled: !!userId,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { head: true, count: 'exact' })
        .eq('is_read', false);
      if (error) throw error;
      return count ?? 0;
    },
    refetchInterval: 30_000,           // background refresh every 30s
    // P4.0 fix: previously true, contributing to the refocus stampede +
    // 401 spam on stale tokens. The 30s interval poll keeps the unread
    // count fresh; visibility-driven refetch is no longer needed.
    refetchOnWindowFocus: false,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() } as never)
        .eq('id', id);
      if (error) throw error;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.profile?.id);
  return useMutation({
    mutationFn: async () => {
      if (!userId) return;
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() } as never)
        .eq('recipient_id', userId)
        .eq('is_read', false);
      if (error) throw error;
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}
