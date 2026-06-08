/**
 * TanStack Query hooks for Phase 2 boards.
 *
 * Conventions:
 *   • Query keys are tuples — easy to invalidate by prefix.
 *   • All data plane calls route through src/lib/db.ts (plain fetch +
 *     cached access token), NOT through supabase.from(). This bypasses
 *     the per-request supabase.auth.getSession() that was the funnel
 *     jam on tab refocus. supabase.auth.* (signIn / refreshSession /
 *     onAuthStateChange) is still in use elsewhere for actual auth.
 *   • Errors propagate up — callers surface via toast (sonner).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { diag } from '@/lib/diag';
import { useAuthStore } from '@/state/authStore';
import {
  dbSelect,
  dbSelectMaybeSingle,
  dbInsert,
  dbInsertReturning,
  dbUpdate,
  dbDelete,
  dbUpsert,
  eq,
  isNull,
  inSet,
} from '@/lib/db';
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
      const [boards, favs] = await Promise.all([
        dbSelect<BoardRow>('boards', {
          filters: { deleted_at: isNull },
          order: 'name.asc',
        }),
        dbSelect<{ board_id: string }>('board_favorites', {
          select: 'board_id',
          filters: { user_id: eq(userId!) },
        }),
      ]);
      const favSet = new Set(favs.map((r) => r.board_id));
      return boards.map((b) => ({ ...b, is_favorite: favSet.has(b.id) }));
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
      // Refocus-wedge instrumentation. After the db.ts conversion the
      // data path no longer awaits supabase.auth.getSession() per
      // request, but we keep these breadcrumbs so a future regression
      // is easy to spot: if "enter" lands but "boards fetch done"
      // never follows, the stall is downstream of timeoutFetch (the
      // [fetch #N] funnel logs will tell you which URL).
      //
      // The explicit getSession() below is a single read-only check
      // per board mount (NOT per request). With autoRefreshToken:false
      // and the per-tab auth lock, it resolves from in-memory state
      // in single-digit milliseconds.
      diag('boardfn', 'enter board=' + (boardId ?? '_'));
      const _t0 = Date.now();
      const { data: _sess } = await supabase.auth.getSession();
      diag('boardfn', 'getSession done in ' + (Date.now() - _t0) + 'ms hasSession=' + !!_sess.session);
      const _t1 = Date.now();
      const [board, fav] = await Promise.all([
        dbSelectMaybeSingle<BoardRow>('boards', {
          filters: { id: eq(boardId!) },
        }),
        dbSelectMaybeSingle<{ board_id: string }>('board_favorites', {
          select: 'board_id',
          filters: { user_id: eq(userId!), board_id: eq(boardId!) },
        }),
      ]);
      diag('boardfn', 'boards fetch done in ' + (Date.now() - _t1) + 'ms');
      if (!board) return null;
      const owner = await dbSelectMaybeSingle<BoardWithOwner['owner']>('users', {
        select: 'id,username,full_name,avatar_url',
        filters: { id: eq(board.owner_id) },
      });
      return { ...board, owner, is_favorite: !!fav };
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
      const subs = await dbSelect<BoardSubscriberRow>('board_subscribers', {
        select: 'board_id,user_id,role,notification_level,subscribed_at',
        filters: { board_id: eq(boardId!) },
      });
      if (subs.length === 0) return [];
      const userIds = subs.map((s) => s.user_id);
      const users = await dbSelect<NonNullable<BoardSubscriberWithUser['user']>>('users', {
        select: 'id,username,full_name,avatar_url',
        filters: { id: inSet(userIds) },
      });
      const map = new Map<string, BoardSubscriberWithUser['user']>(users.map((u) => [u.id, u]));
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
      const ws = await dbSelectMaybeSingle<{ id: string }>('workspaces', {
        select: 'id',
        filters: { is_main: 'eq.true' },
      });
      if (!ws) throw new Error('Main workspace not found');
      const wsId = ws.id;
      const insert = {
        workspace_id: wsId,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        icon_emoji: input.icon_emoji ?? '📋',
        board_type: input.board_type ?? 'main',
        owner_id: userId,
        created_by: userId,
      };
      return await dbInsertReturning<BoardRow>('boards', insert);
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
      await dbUpdate('boards', { id: eq(id) }, patch);
      // Re-read the row so onSuccess can patch the cache with the live
      // copy (same shape as the previous supabase-js .select('*').single()).
      const row = await dbSelectMaybeSingle<BoardRow>('boards', {
        filters: { id: eq(id) },
      });
      if (!row) throw new Error('Board not found after update');
      return row;
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
      await dbUpdate('boards', { id: eq(id) }, { archived_at: new Date().toISOString() });
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
      await dbUpdate('boards', { id: eq(id) }, { archived_at: null });
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
      await dbUpdate('boards', { id: eq(id) }, { deleted_at: new Date().toISOString() });
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
        try {
          await dbInsert('board_favorites', { user_id: userId, board_id: boardId });
        } catch (err) {
          // ignore duplicate-key (Postgres 23505)
          const code = (err as { code?: string })?.code;
          if (code !== '23505') throw err;
        }
      } else {
        await dbDelete('board_favorites', { user_id: eq(userId), board_id: eq(boardId) });
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
      await dbUpsert('board_last_viewed', {
        board_id: boardId,
        user_id: userId,
        last_viewed_at: new Date().toISOString(),
      }, { onConflict: 'board_id,user_id' });
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
      const views = await dbSelect<Pick<BoardLastViewedRow, 'board_id' | 'last_viewed_at'>>('board_last_viewed', {
        select: 'board_id,last_viewed_at',
        filters: { user_id: eq(userId!) },
        order: 'last_viewed_at.desc',
        limit,
      });
      if (views.length === 0) return [];
      const boardIds = views.map((r) => r.board_id);
      const boards = await dbSelect<BoardRow>('boards', {
        filters: { id: inSet(boardIds), deleted_at: isNull },
      });
      const map = new Map<string, BoardRow>(boards.map((b) => [b.id, b]));
      return views
        .map((r) => {
          const b = map.get(r.board_id);
          return b ? { board: b, last_viewed_at: r.last_viewed_at } : null;
        })
        .filter((x): x is RecentBoard => !!x);
    },
  });
}
