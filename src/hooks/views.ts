import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/state/authStore';
import {
  dbSelect,
  dbInsertReturning,
  dbUpdate,
  dbDelete,
  eq,
  isNull,
} from '@/lib/db';
import type { ViewRow, ViewType } from '@/lib/database.types';

export const viewKeys = {
  all: ['views'] as const,
  byBoard: (boardId: string) => [...viewKeys.all, 'board', boardId] as const,
};

export function useViews(boardId: string | undefined) {
  return useQuery({
    queryKey: boardId ? viewKeys.byBoard(boardId) : ['views', '_'],
    enabled: !!boardId,
    queryFn: async (): Promise<ViewRow[]> => {
      return await dbSelect<ViewRow>('views', {
        filters: { board_id: eq(boardId!), archived_at: isNull },
        order: 'sort_order.asc',
      });
    },
  });
}

export interface CreateViewInput {
  boardId: string;
  name: string;
  type: ViewType;
  settings?: Record<string, unknown>;
}

export function useCreateView() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.profile?.id);
  return useMutation({
    mutationFn: async (input: CreateViewInput): Promise<ViewRow> => {
      if (!userId) throw new Error('Not signed in');
      const existing = await dbSelect<{ sort_order: number }>('views', {
        select: 'sort_order',
        filters: { board_id: eq(input.boardId) },
        order: 'sort_order.desc',
        limit: 1,
      });
      const nextSort = (existing[0]?.sort_order ?? -1) + 1;
      const payload = {
        board_id: input.boardId,
        name: input.name.trim() || `New ${input.type}`,
        type: input.type,
        sort_order: nextSort,
        is_default: false,
        created_by: userId,
        settings: input.settings ?? {},
      };
      return await dbInsertReturning<ViewRow>('views', payload);
    },
    onSuccess: (v) => void qc.invalidateQueries({ queryKey: viewKeys.byBoard(v.board_id) }),
  });
}

export function useUpdateView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id, boardId, patch,
    }: {
      id: string; boardId: string;
      patch: Partial<Pick<ViewRow, 'name' | 'settings' | 'sort_order' | 'is_default'>>;
    }) => {
      await dbUpdate('views', { id: eq(id) }, patch);
      return { id, boardId };
    },
    onSuccess: ({ boardId }) => void qc.invalidateQueries({ queryKey: viewKeys.byBoard(boardId) }),
  });
}

export function useDeleteView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, boardId }: { id: string; boardId: string }) => {
      await dbDelete('views', { id: eq(id) });
      return { id, boardId };
    },
    onSuccess: ({ boardId }) => void qc.invalidateQueries({ queryKey: viewKeys.byBoard(boardId) }),
  });
}
