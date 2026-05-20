import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/state/authStore';
import type { FileRow } from '@/lib/database.types';

export const fileKeys = {
  all: ['files'] as const,
  byItem: (itemId: string) => [...fileKeys.all, 'item', itemId] as const,
  byCell: (itemId: string, columnId: string) =>
    [...fileKeys.all, 'cell', itemId, columnId] as const,
  signedUrl: (path: string) => [...fileKeys.all, 'url', path] as const,
};

const BUCKET = 'task-files';

function makeStoragePath(opts: {
  boardId: string;
  itemId?: string | null;
  updateId?: string | null;
  fileName: string;
}): string {
  const safe = opts.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const fileId = crypto.randomUUID();
  if (opts.itemId) return `boards/${opts.boardId}/items/${opts.itemId}/${fileId}-${safe}`;
  if (opts.updateId) return `boards/${opts.boardId}/updates/${opts.updateId}/${fileId}-${safe}`;
  throw new Error('makeStoragePath requires itemId or updateId');
}

// ---------------------------------------------------------------------
// useItemFiles — files attached at the item level (not column-cell)
// ---------------------------------------------------------------------
export function useItemFiles(itemId: string | undefined) {
  return useQuery({
    queryKey: itemId ? fileKeys.byItem(itemId) : ['files', '_'],
    enabled: !!itemId,
    queryFn: async (): Promise<FileRow[]> => {
      const { data, error } = await supabase
        .from('files')
        .select('*')
        .eq('item_id', itemId!)
        .is('column_id', null)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as FileRow[];
    },
  });
}

// ---------------------------------------------------------------------
// useUploadFile — uploads to storage + inserts files row
// ---------------------------------------------------------------------
interface UploadInput {
  boardId: string;
  file: File;
  itemId?: string;
  updateId?: string;
  columnId?: string;
}

export function useUploadFile() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.profile?.id);
  return useMutation({
    mutationFn: async ({ boardId, file, itemId, updateId, columnId }: UploadInput): Promise<FileRow> => {
      if (!userId) throw new Error('Not signed in');
      if (!itemId && !updateId) throw new Error('Need itemId or updateId');

      const path = makeStoragePath({ boardId, itemId, updateId, fileName: file.name });
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type || 'application/octet-stream',
        });
      if (upErr) throw upErr;

      const insert = {
        uploader_id: userId,
        item_id: itemId ?? null,
        update_id: updateId ?? null,
        column_id: columnId ?? null,
        storage_path: path,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type || 'application/octet-stream',
      };
      const { data, error } = await supabase
        .from('files')
        .insert(insert as never)
        .select('*')
        .single();
      if (error) {
        // Roll back the storage upload if the DB row failed.
        await supabase.storage.from(BUCKET).remove([path]);
        throw error;
      }
      return data as FileRow;
    },
    onSuccess: (f) => {
      if (f.item_id) {
        void qc.invalidateQueries({ queryKey: fileKeys.byItem(f.item_id) });
        if (f.column_id) {
          void qc.invalidateQueries({ queryKey: fileKeys.byCell(f.item_id, f.column_id) });
        }
      }
    },
  });
}

// ---------------------------------------------------------------------
// useDeleteFile — soft delete the row, hard delete the object
// ---------------------------------------------------------------------
export function useDeleteFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: FileRow) => {
      // Remove from storage first; if it fails, the row stays alive and
      // we can retry.  RLS already restricts to owner/admin.
      const { error: rmErr } = await supabase.storage.from(BUCKET).remove([file.storage_path]);
      if (rmErr && rmErr.message && !/not found/i.test(rmErr.message)) throw rmErr;
      const { error } = await supabase
        .from('files')
        .update({ deleted_at: new Date().toISOString() } as never)
        .eq('id', file.id);
      if (error) throw error;
      return file;
    },
    onSuccess: (f) => {
      if (f.item_id) {
        void qc.invalidateQueries({ queryKey: fileKeys.byItem(f.item_id) });
        if (f.column_id) {
          void qc.invalidateQueries({ queryKey: fileKeys.byCell(f.item_id, f.column_id) });
        }
      }
      if (f.update_id) void qc.invalidateQueries({ queryKey: ['updates'] });
    },
  });
}

// ---------------------------------------------------------------------
// useFileUrl — fresh signed URL for download / inline preview
// ---------------------------------------------------------------------
export function useFileUrl(path: string | null | undefined, expiresInSec = 60 * 60) {
  return useQuery({
    queryKey: path ? fileKeys.signedUrl(path) : ['files', 'url', '_'],
    enabled: !!path,
    staleTime: (expiresInSec - 60) * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path!, expiresInSec);
      if (error) throw error;
      return data.signedUrl;
    },
  });
}

// ---------------------------------------------------------------------
// useCellFiles — files attached to a specific item-column pair (files col)
// ---------------------------------------------------------------------
export function useCellFiles(itemId: string | undefined, columnId: string | undefined) {
  return useQuery({
    queryKey: itemId && columnId ? fileKeys.byCell(itemId, columnId) : ['files', 'cell', '_'],
    enabled: !!itemId && !!columnId,
    queryFn: async (): Promise<FileRow[]> => {
      const { data, error } = await supabase
        .from('files')
        .select('*')
        .eq('item_id', itemId!)
        .eq('column_id', columnId!)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as FileRow[];
    },
  });
}
