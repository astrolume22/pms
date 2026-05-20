/**
 * TanStack Query hooks for Phase 2 boards.
 *
 * Conventions:
 *   • Query keys are tuples — easy to invalidate by prefix.
 *   • Mutations cast their payloads to `never` to bypass the untyped
 *     Supabase client; we'll generate proper Database types later via
 *     `supabase gen types typescript`.
 *   • Errors propagate from the Supabase client — callers surface via
 *     toast (sonner).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/state/authStore';
import type {
  BoardRow,
  BoardSubscriberRow,
  BoardType,
  BoardLastViewedRow,
  UserRow,
} from '@/lib/database.types';

// ---------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------
export const boardKeys = {
  all:         ['boards'] as const,
  list:        () => [...boardKeys.all, 'list'] as const,
  detail:      (id: string) => [...boardKeys.all, 'detail', id] as const,
  subscribers: (id: string) => [...boardKeys.all, 'subscribers', id] as const,
  favorites:   () => ['board-favorites'] as const,
  recents:     () => ['board-recents'] as const,
};

// ---------------------------------------------------------------------
// useBoards — every board the current user can see (RLS-filtered)
// ---------------------------------------------------------------------
export interface BoardListItem extends BoardRow {
  is_favorite: boolean;
}

export function useBoards() {
  const userId = useAuthStore((s) => s.profile?.id);
  return useQuery({
    queryKey: boardKeys.list(),
    enabled: !!userId,
    queryFn: async (): Promise<BoardListItem[]> => {
      const [{ data: boards, error: boardsErr }, { data: favs, error: favsErr }] = await Promise.all([
        supabase
          .from('boards')
          .select('*')
          .is('deleted_at', null)
          .order('name', { ascending: true }),
        supabase.from('board_favorites').select('board_id').eq('user_id', userId!),
      ]);
      if (boardsErr) throw boardsErr;
      if (favsErr) throw favsErr;
      const favSet = new Set((favs ?? []).map((r) => (r as { board_id: string }).board_id));
      return ((boards ?? []) as BoardRow[]).map((b) => ({ ...b, is_favorite: favSet.has(b.id) }));
    },
  });
}

// ---------------------------------------------------------------------
// useBoard — one board with its owner profile attached
// ---------------------------------------------------------------------
export interface BoardWithOwner extends BoardRow {
  owner: Pick<UserRow, 'id' | 'username' | 'full_name' | 'avatar_url'> | null;
  is_favorite: boolean;
}

export function useBoard(boardId: string | undefined) {
  const userId = useAuthStore((s) => s.profile?.id);
  return useQuery({
    queryKey: boardId ? boardKeys.detail(boardId) : ['boards', 'detail', '_'],
    enabled: !!boardId && !!userId,
    queryFn: async (): Promise<BoardWithOwner | null> => {
      const [{ data: board, error }, { data: fav }] = await Promise.all([
        supabase.from('boards').select('*').eq('id', boardId!).maybeSingle(),
        supabase
          .from('board_favorites')
          .select('board_id')
          .eq('user_id', userId!)
          .eq('board_id', boardId!)
          .maybeSingle(),
      ]);
      if (error) throw error;
      if (!board) return null;
      const b = board as BoardRow;
      const { data: owner } = await supabase
        .from('users')
        .select('id, username, full_name, avatar_url')
        .eq('id', b.owner_id)
        .maybeSingle();
      return { ...b, owner: (owner as BoardWithOwner['owner']) ?? null, is_favorite: !!fav };
    },
  });
}

// ---------------------------------------------------------------------
// useBoardSubscribers
// ---------------------------------------------------------------------
export interface BoardSubscriberWithUser extends BoardSubscriberRow {
  user: Pick<UserRow, 'id' | 'username' | 'full_name' | 'avatar_url'> | null;
}

export function useBoardSubscribers(boardId: string | undefined) {
  return useQuery({
    queryKey: boardId ? boardKeys.subscribers(boardId) : ['boards', 'subs', '_'],
    enabled: !!boardId,
    queryFn: async (): Promise<BoardSubscriberWithUser[]> => {
      const { data, error } = await supabase
        .from('board_subscribers')
        .select('board_id, user_id, role, notification_level, subscribed_at')
        .eq('board_id', boardId!);
      if (error) throw error;
      const subs = (data ?? []) as BoardSubscriberRow[];
      if (subs.length === 0) return [];
      const userIds = subs.map((s) => s.user_id);
      const { data: users } = await supabase
        .from('users')
        .select('id, username, full_name, avatar_url')
        .in('id', userIds);
      const map = new Map<string, BoardSubscriberWithUser['user']>(
        ((users ?? []) as NonNullable<BoardSubscriberWithUser['user']>[]).map((u) => [u.id, u]),
      );
      return subs.map((s) => ({ ...s, user: map.get(s.user_id) ?? null }));
    },
  });
}

// ---------------------------------------------------------------------
// useCreateBoard
// ---------------------------------------------------------------------
export interface CreateBoardInput {
  name: string;
  description?: string;
  icon_emoji?: string;
  board_type?: BoardType;
}

export function useCreateBoard() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.profile?.id);
  return useMutation({
    mutationFn: async (input: CreateBoardInput): Promise<BoardRow> => {
      if (!userId) throw new Error('Not signed in');
      // Look up the main workspace id — single-workspace V1.
      const { data: ws, error: wsErr } = await supabase
        .from('workspaces')
        .select('id')
        .eq('is_main', true)
        .maybeSingle();
      if (wsErr) throw wsErr;
      if (!ws) throw new Error('Main workspace not found');
      const wsId = (ws as { id: string }).id;
      const insert = {
        workspace_id: wsId,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        icon_emoji: input.icon_emoji ?? '📋',
        board_type: input.board_type ?? 'main',
        owner_id: userId,
        created_by: userId,
      };
      const { data, error } = await supabase
        .from('boards')
        .insert(insert as never)
        .select('*')
        .single();
      if (error) throw error;
      return data as BoardRow;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: boardKeys.all });
    },
  });
}

// ---------------------------------------------------------------------
// useUpdateBoard — partial patch (name, description, icon, type)
// ---------------------------------------------------------------------
export interface UpdateBoardInput {
  id: string;
  patch: Partial<Pick<BoardRow, 'name' | 'description' | 'icon_emoji' | 'board_type'>>;
}

export function useUpdateBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: UpdateBoardInput): Promise<BoardRow> => {
      const { data, error } = await supabase
        .from('boards')
        .update(patch as never)
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw error;
      return data as BoardRow;
    },
    onSuccess: (board) => {
      qc.setQueryData(boardKeys.detail(board.id), (prev: BoardWithOwner | undefined) =>
        prev ? { ...prev, ...board } : prev,
      );
      void qc.invalidateQueries({ queryKey: boardKeys.list() });
    },
  });
}

// ---------------------------------------------------------------------
// useArchiveBoard / useRestoreBoard / useDeleteBoard (soft delete)
// ---------------------------------------------------------------------
export function useArchiveBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('boards')
        .update({ archived_at: new Date().toISOString() } as never)
        .eq('id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => {
      void qc.invalidateQueries({ queryKey: boardKeys.all });
      void qc.invalidateQueries({ queryKey: boardKeys.detail(id) });
    },
  });
}

export function useRestoreBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('boards')
        .update({ archived_at: null } as never)
        .eq('id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => {
      void qc.invalidateQueries({ queryKey: boardKeys.all });
      void qc.invalidateQueries({ queryKey: boardKeys.detail(id) });
    },
  });
}

export function useDeleteBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('boards')
        .update({ deleted_at: new Date().toISOString() } as never)
        .eq('id', id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: boardKeys.all });
    },
  });
}

// ---------------------------------------------------------------------
// useToggleFavorite
// ---------------------------------------------------------------------
export function useToggleFavorite() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.profile?.id);
  return useMutation({
    mutationFn: async ({ boardId, makeFavorite }: { boardId: string; makeFavorite: boolean }) => {
      if (!userId) throw new Error('Not signed in');
      if (makeFavorite) {
        const { error } = await supabase
          .from('board_favorites')
          .insert({ user_id: userId, board_id: boardId } as never);
        if (error && error.code !== '23505') throw error; // ignore duplicate
      } else {
        const { error } = await supabase
          .from('board_favorites')
          .delete()
          .eq('user_id', userId)
          .eq('board_id', boardId);
        if (error) throw error;
      }
      return { boardId, makeFavorite };
    },
    onSuccess: ({ boardId, makeFavorite }) => {
      // Patch list cache eagerly
      qc.setQueryData<BoardListItem[]>(boardKeys.list(), (prev) =>
        prev ? prev.map((b) => (b.id === boardId ? { ...b, is_favorite: makeFavorite } : b)) : prev,
      );
      qc.setQueryData<BoardWithOwner | null>(boardKeys.detail(boardId), (prev) =>
        prev ? { ...prev, is_favorite: makeFavorite } : prev,
      );
      void qc.invalidateQueries({ queryKey: boardKeys.favorites() });
    },
  });
}

// ---------------------------------------------------------------------
// useUpdateLastViewed — upsert on the (board, user) pair
// ---------------------------------------------------------------------
export function useUpdateLastViewed() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.profile?.id);
  return useMutation({
    mutationFn: async (boardId: string) => {
      if (!userId) throw new Error('Not signed in');
      const { error } = await supabase
        .from('board_last_viewed')
        .upsert(
          {
            board_id: boardId,
            user_id: userId,
            last_viewed_at: new Date().toISOString(),
          } as never,
          { onConflict: 'board_id,user_id' },
        );
      if (error) throw error;
      return boardId;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: boardKeys.recents() });
    },
  });
}

// ---------------------------------------------------------------------
// useRecentBoards — last N visited boards for current user
// ---------------------------------------------------------------------
export interface RecentBoard {
  board: BoardRow;
  last_viewed_at: string;
}

export function useRecentBoards(limit = 10) {
  const userId = useAuthStore((s) => s.profile?.id);
  return useQuery({
    queryKey: [...boardKeys.recents(), limit],
    enabled: !!userId,
    queryFn: async (): Promise<RecentBoard[]> => {
      const { data: views, error } = await supabase
        .from('board_last_viewed')
        .select('board_id, last_viewed_at')
        .eq('user_id', userId!)
        .order('last_viewed_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      const rows = (views ?? []) as Pick<BoardLastViewedRow, 'board_id' | 'last_viewed_at'>[];
      if (rows.length === 0) return [];
      const boardIds = rows.map((r) => r.board_id);
      const { data: boards } = await supabase
        .from('boards')
        .select('*')
        .in('id', boardIds)
        .is('deleted_at', null);
      const map = new Map<string, BoardRow>(((boards ?? []) as BoardRow[]).map((b) => [b.id, b]));
      return rows
        .map((r) => {
          const b = map.get(r.board_id);
          return b ? { board: b, last_viewed_at: r.last_viewed_at } : null;
        })
        .filter((x): x is RecentBoard => !!x);
    },
  });
}
