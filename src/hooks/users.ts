import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { UserRow } from '@/lib/database.types';

export const userKeys = {
  active: ['users', 'active'] as const,
};

// Used by the people picker.  Only active users — no emails returned.
export function useActiveUsers() {
  return useQuery({
    queryKey: userKeys.active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, username, full_name, avatar_url, role, status')
        .eq('status', 'active')
        .order('username', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Pick<UserRow, 'id' | 'username' | 'full_name' | 'avatar_url' | 'role' | 'status'>[];
    },
  });
}
