/**
 * Phase 6.5 — Invite link hooks. Everything goes through SECURITY
 * DEFINER RPCs in migration 0020 so the role checks live server-side.
 *
 * `useInvitesForBoard` and `useCreateInvite` need an authenticated user
 * (admin / manager / board owner). `useInviteByToken` and
 * `useAcceptInvite` are public — they're called from the un-authed
 * /invite/{token} accept page.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { UserRole } from '@/lib/database.types';

export const inviteKeys = {
  all: ['invites'] as const,
  board: (boardId: string) => [...inviteKeys.all, 'board', boardId] as const,
  token: (token: string) => [...inviteKeys.all, 'token', token] as const,
};

export interface InviteRow {
  id: string;
  token: string;
  role: UserRole;
  board_id: string | null;
  created_by: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  used_by: string | null;
  revoked_at: string | null;
}

// ---------------------------------------------------------------------
// List all pending + recent invites for a specific board (board_id) or
// workspace-wide (boardId === null). RLS returns the rows the caller is
// allowed to see (admin / creator / board owner).
// ---------------------------------------------------------------------
export function useInvitesForBoard(boardId: string | null) {
  return useQuery({
    queryKey: boardId ? inviteKeys.board(boardId) : ['invites', 'workspace'],
    queryFn: async (): Promise<InviteRow[]> => {
      let q = supabase.from('invites').select('*').order('created_at', { ascending: false });
      if (boardId) q = q.eq('board_id', boardId);
      else q = q.is('board_id', null);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as InviteRow[];
    },
    staleTime: 10_000,
  });
}

export function useCreateInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      role: UserRole;
      boardId: string | null;
      expiresInHours?: number;
    }): Promise<{ id: string; token: string; role: UserRole; board_id: string | null; expires_at: string }> => {
      const { data, error } = await supabase.rpc('create_invite', {
        p_role: args.role,
        p_board_id: args.boardId,
        p_expires_in_hours: args.expiresInHours ?? 168,
      });
      if (error) throw error;
      return data as { id: string; token: string; role: UserRole; board_id: string | null; expires_at: string };
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({
        queryKey: vars.boardId ? inviteKeys.board(vars.boardId) : ['invites', 'workspace'],
      });
    },
  });
}

export function useRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; boardId: string | null }) => {
      const { error } = await supabase.rpc('revoke_invite', { p_invite_id: args.id });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({
        queryKey: vars.boardId ? inviteKeys.board(vars.boardId) : ['invites', 'workspace'],
      });
    },
  });
}

// ---------------------------------------------------------------------
// Anon-safe: used on the accept page before any user exists.
// ---------------------------------------------------------------------
export interface InviteCheckResult {
  valid: boolean;
  reason?: 'not_found' | 'expired' | 'revoked' | 'used' | 'missing';
  role?: UserRole;
  board_id?: string | null;
  board_name?: string | null;
  expires_at?: string;
}

export function useInviteByToken(token: string | undefined) {
  return useQuery({
    queryKey: token ? inviteKeys.token(token) : ['invites', 'token', '_'],
    enabled: !!token,
    queryFn: async (): Promise<InviteCheckResult> => {
      const { data, error } = await supabase.rpc('get_invite_by_token', { p_token: token });
      if (error) throw error;
      return (data as InviteCheckResult) ?? { valid: false, reason: 'not_found' };
    },
    staleTime: 30_000,
  });
}

export function useAcceptInvite() {
  return useMutation({
    mutationFn: async (args: {
      token: string;
      username: string;
      fullName: string;
      password: string;
    }): Promise<{ user_id: string; username: string; email: string; board_id: string | null }> => {
      const { data, error } = await supabase.rpc('accept_invite', {
        p_token: args.token,
        p_username: args.username,
        p_full_name: args.fullName,
        p_password: args.password,
      });
      if (error) throw error;
      return data as { user_id: string; username: string; email: string; board_id: string | null };
    },
  });
}
