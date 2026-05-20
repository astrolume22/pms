import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/state/authStore';
import type { UpdateRow, UpdateReactionRow } from '@/lib/database.types';

export const updateKeys = {
  all: ['updates'] as const,
  byItem: (itemId: string) => [...updateKeys.all, 'item', itemId] as const,
  reactionsByUpdate: (updateId: string) =>
    [...updateKeys.all, 'reactions', updateId] as const,
};

// ---------------------------------------------------------------------
// useItemUpdates — comments + their reactions in one query
// ---------------------------------------------------------------------
export interface UpdateWithMeta extends UpdateRow {
  reactions: UpdateReactionRow[];
  mentioned_user_ids: string[];
}

export function useItemUpdates(itemId: string | undefined) {
  return useQuery({
    queryKey: itemId ? updateKeys.byItem(itemId) : ['updates', '_'],
    enabled: !!itemId,
    queryFn: async (): Promise<UpdateWithMeta[]> => {
      const { data: updates, error } = await supabase
        .from('updates')
        .select('*')
        .eq('item_id', itemId!)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });
      if (error) throw error;
      const rows = (updates ?? []) as UpdateRow[];
      if (rows.length === 0) return [];

      const updateIds = rows.map((u) => u.id);
      const [{ data: reactions }, { data: mentions }] = await Promise.all([
        supabase.from('update_reactions').select('*').in('update_id', updateIds),
        supabase.from('update_mentions').select('update_id, mentioned_user_id').in('update_id', updateIds),
      ]);

      const reactionsByUpdate = new Map<string, UpdateReactionRow[]>();
      for (const r of (reactions ?? []) as UpdateReactionRow[]) {
        const arr = reactionsByUpdate.get(r.update_id) ?? [];
        arr.push(r);
        reactionsByUpdate.set(r.update_id, arr);
      }
      const mentionsByUpdate = new Map<string, string[]>();
      for (const m of (mentions ?? []) as { update_id: string; mentioned_user_id: string }[]) {
        const arr = mentionsByUpdate.get(m.update_id) ?? [];
        arr.push(m.mentioned_user_id);
        mentionsByUpdate.set(m.update_id, arr);
      }
      return rows.map((u) => ({
        ...u,
        reactions: reactionsByUpdate.get(u.id) ?? [],
        mentioned_user_ids: mentionsByUpdate.get(u.id) ?? [],
      }));
    },
  });
}

// ---------------------------------------------------------------------
// useCreateUpdate — inserts update + mention rows
// ---------------------------------------------------------------------
export interface CreateUpdateInput {
  itemId: string;
  bodyHtml: string;
  bodyJson: unknown;
  mentionedUserIds: string[];
}

export function useCreateUpdate() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.profile?.id);
  return useMutation({
    mutationFn: async ({ itemId, bodyHtml, bodyJson, mentionedUserIds }: CreateUpdateInput) => {
      if (!userId) throw new Error('Not signed in');
      const { data, error } = await supabase
        .from('updates')
        .insert({
          item_id: itemId,
          author_id: userId,
          body_html: bodyHtml,
          body_json: bodyJson,
        } as never)
        .select('*')
        .single();
      if (error) throw error;
      const update = data as UpdateRow;
      // De-dup mentions and self.
      const ids = Array.from(new Set(mentionedUserIds)).filter((id) => id !== userId);
      if (ids.length > 0) {
        const { error: mErr } = await supabase
          .from('update_mentions')
          .insert(ids.map((mid) => ({ update_id: update.id, mentioned_user_id: mid })) as never);
        if (mErr) throw mErr;
      }
      return update;
    },
    onSuccess: (u) => {
      void qc.invalidateQueries({ queryKey: updateKeys.byItem(u.item_id) });
    },
  });
}

// ---------------------------------------------------------------------
// useEditUpdate
// ---------------------------------------------------------------------
export function useEditUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id, bodyHtml, bodyJson, itemId,
    }: { id: string; itemId: string; bodyHtml: string; bodyJson: unknown }) => {
      const { error } = await supabase
        .from('updates')
        .update({ body_html: bodyHtml, body_json: bodyJson } as never)
        .eq('id', id);
      if (error) throw error;
    },
    onSettled: (_d, _e, vars) => void qc.invalidateQueries({ queryKey: updateKeys.byItem(vars.itemId) }),
  });
}

// ---------------------------------------------------------------------
// useDeleteUpdate — soft delete
// ---------------------------------------------------------------------
export function useDeleteUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; itemId: string }) => {
      const { error } = await supabase
        .from('updates')
        .update({ deleted_at: new Date().toISOString() } as never)
        .eq('id', id);
      if (error) throw error;
    },
    onSettled: (_d, _e, vars) => void qc.invalidateQueries({ queryKey: updateKeys.byItem(vars.itemId) }),
  });
}

// ---------------------------------------------------------------------
// useToggleReaction — add or remove a user's emoji on an update
// ---------------------------------------------------------------------
export function useToggleReaction() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.profile?.id);
  return useMutation({
    mutationFn: async ({ updateId, emoji, itemId, currentlyOn }: {
      updateId: string; emoji: string; itemId: string; currentlyOn: boolean;
    }) => {
      if (!userId) throw new Error('Not signed in');
      if (currentlyOn) {
        const { error } = await supabase
          .from('update_reactions')
          .delete()
          .eq('update_id', updateId)
          .eq('user_id', userId)
          .eq('emoji', emoji);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('update_reactions')
          .insert({ update_id: updateId, user_id: userId, emoji } as never);
        if (error && error.code !== '23505') throw error;
      }
    },
    onSettled: (_d, _e, vars) => void qc.invalidateQueries({ queryKey: updateKeys.byItem(vars.itemId) }),
  });
}
