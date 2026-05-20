import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { ActivityLogRow } from '@/lib/database.types';

export const activityKeys = {
  all: ['activity'] as const,
  byItem: (itemId: string) => [...activityKeys.all, 'item', itemId] as const,
};

export function useItemActivity(itemId: string | undefined) {
  return useQuery({
    queryKey: itemId ? activityKeys.byItem(itemId) : ['activity', '_'],
    enabled: !!itemId,
    queryFn: async (): Promise<ActivityLogRow[]> => {
      const { data, error } = await supabase
        .from('activity_log')
        .select('*')
        .eq('target_type', 'item')
        .eq('target_id', itemId!)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as ActivityLogRow[];
    },
  });
}
