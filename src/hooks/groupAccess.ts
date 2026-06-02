/**
 * Phase 3 — per-group visibility ACL hooks.
 *
 * The DB layer is migration 0055: a single source of truth
 * `public.group_user_visibility (user_id, group_id, granted_by, created_at)`
 * with RLS that lets admins write and lets users read their own grants.
 * The amended groups_select policy means a non-admin only sees groups
 * they have an ACL row for. Admins still see everything.
 *
 * These hooks are admin-only on the write paths — the user sitting in
 * the Group Access admin section is an admin (route gate). The RLS
 * also rejects writes from non-admins, so the frontend is a single
 * line of defense and the DB is the second.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { GroupRow } from '@/lib/database.types';

export const groupAccessKeys = {
  all:           ['group-access'] as const,
  boardGroups:   (boardId: string) => [...groupAccessKeys.all, 'board-groups', boardId] as const,
  userOnBoard:   (userId: string, boardId: string) =>
    [...groupAccessKeys.all, 'user-board', userId, boardId] as const,
};

// ---------------------------------------------------------------------
// useBoardGroups — every alive group on a board (for the matrix axes).
// ---------------------------------------------------------------------
// Admins see all groups via RLS bypass; this hook is only called from
// the admin section, so we trust that. Sorted by sort_order so the
// matrix matches the in-board ordering.
export interface BoardGroupRow {
  id: string;
  name: string;
  color: string;
  sort_order: number;
}
export function useBoardGroups(boardId: string | undefined) {
  return useQuery({
    queryKey: boardId ? groupAccessKeys.boardGroups(boardId) : ['group-access', 'board-groups', '_'],
    enabled: !!boardId,
    queryFn: async (): Promise<BoardGroupRow[]> => {
      const { data, error } = await supabase
        .from('groups')
        .select('id, name, color, sort_order')
        .eq('board_id', boardId!)
        .is('deleted_at', null)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data ?? []) as BoardGroupRow[];
    },
  });
}

// ---------------------------------------------------------------------
// useUserGroupVisibility — which group_ids on this board are granted to
// this user? Returns a Set for O(1) toggle lookup in the UI.
// ---------------------------------------------------------------------
export function useUserGroupVisibility(userId: string | undefined, boardId: string | undefined) {
  return useQuery({
    queryKey: userId && boardId
      ? groupAccessKeys.userOnBoard(userId, boardId)
      : ['group-access', 'user-board', '_'],
    enabled: !!userId && !!boardId,
    queryFn: async (): Promise<Set<string>> => {
      // The amended guv_select RLS lets admins read every row, and
      // lets a non-admin read their own. Both work here — we're
      // either showing the admin matrix (admin viewer) or, if we ever
      // surface "your access" elsewhere, the same query is safe.
      //
      // Join against groups on board_id so we only count rows for
      // groups that actually belong to this board (the ACL table
      // doesn't carry board_id by design — group_id IS the FK).
      const { data, error } = await supabase
        .from('group_user_visibility')
        .select('group_id, groups!inner(board_id)')
        .eq('user_id', userId!)
        .eq('groups.board_id', boardId!);
      if (error) throw error;
      return new Set(
        (data ?? []).map((r) => (r as { group_id: string }).group_id)
      );
    },
  });
}

// ---------------------------------------------------------------------
// useGrantGroupAccess — admin grants one (user × group) ACL row.
// ---------------------------------------------------------------------
// Single-row insert by composite PK; ON CONFLICT DO NOTHING semantics
// via the unique constraint + onConflict ignoreDuplicates flag.
// granted_by is filled by the caller from the current admin's profile.
export function useGrantGroupAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { userId: string; groupId: string; grantedBy: string }) => {
      const { error } = await supabase
        .from('group_user_visibility')
        .upsert(
          { user_id: args.userId, group_id: args.groupId, granted_by: args.grantedBy } as never,
          { onConflict: 'user_id,group_id', ignoreDuplicates: true }
        );
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      // Bust every query that could be staring at this user × group.
      // Cheap: only the admin matrix and the affected user's own
      // grant list reference these keys.
      void qc.invalidateQueries({ queryKey: groupAccessKeys.all });
      // The amended groups_select means the user's own useGroups
      // for this board has just become stale for *them* — but the
      // current viewer is the admin, so their useGroups is fine.
      // We deliberately don't touch board groups cache here.
      void vars;
    },
  });
}

// ---------------------------------------------------------------------
// useRevokeGroupAccess — admin revokes one (user × group) ACL row.
// ---------------------------------------------------------------------
export function useRevokeGroupAccess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { userId: string; groupId: string }) => {
      const { error } = await supabase
        .from('group_user_visibility')
        .delete()
        .eq('user_id', args.userId)
        .eq('group_id', args.groupId);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: groupAccessKeys.all });
    },
  });
}

// Re-export the alive-groups row shape so call sites can avoid digging
// into hook return types.
export type { GroupRow };
