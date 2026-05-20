import { useRef, useState } from 'react';
import { Paperclip, Upload, X } from 'lucide-react';
import { Popover } from '../Popover';
import { useCellFiles, useUploadFile, useDeleteFile, useFileUrl } from '@/hooks/files';
import { Spinner } from '@/components/Spinner';
import { useAuthStore } from '@/state/authStore';
import type { CellProps } from './cellTypes';
import type { FileRow } from '@/lib/database.types';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';

export function FilesCell({ item, column, boardId, readonly, isEditing, onStartEdit, onEndEdit }: CellProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const { data: files } = useCellFiles(item.id, column.id);

  const count = files?.length ?? 0;
  const previewable = (files ?? []).filter((f) => f.mime_type.startsWith('image/')).slice(0, 3);

  return (
    <>
      <div
        ref={anchorRef}
        className={cn(
          'w-full h-full flex items-center gap-1 px-2',
          !readonly && 'cursor-pointer',
        )}
        onClick={() => !readonly && (isEditing ? onEndEdit() : onStartEdit())}
      >
        {count === 0 ? (
          <span className="text-xs text-text-disabled inline-flex items-center gap-1">
            <Paperclip className="h-3 w-3" />
            —
          </span>
        ) : (
          <div className="flex items-center gap-1 overflow-hidden">
            <Paperclip className="h-3 w-3 text-text-secondary shrink-0" />
            <span className="text-xs text-text-secondary">{count}</span>
            {previewable.length > 0 && <Thumbs files={previewable} />}
          </div>
        )}
      </div>
      <Popover anchorRef={anchorRef} open={isEditing} onClose={onEndEdit} minWidth={320}>
        <FilesPopoverContent
          boardId={boardId}
          itemId={item.id}
          columnId={column.id}
          files={files ?? []}
        />
      </Popover>
    </>
  );
}

function Thumbs({ files }: { files: FileRow[] }) {
  return (
    <div className="flex items-center -space-x-1">
      {files.map((f) => (
        <Thumb key={f.id} file={f} />
      ))}
    </div>
  );
}

function Thumb({ file }: { file: FileRow }) {
  const { data: url } = useFileUrl(file.storage_path);
  return (
    <div className="h-6 w-6 rounded-sm overflow-hidden border border-border-light bg-app">
      {url ? <img src={url} alt={file.file_name} className="h-full w-full object-cover" /> : null}
    </div>
  );
}

function FilesPopoverContent({
  boardId, itemId, columnId, files,
}: { boardId: string; itemId: string; columnId: string; files: FileRow[] }) {
  const profile = useAuthStore((s) => s.profile);
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadFile();
  const del = useDeleteFile();
  const [dragging, setDragging] = useState(false);

  const onUpload = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    for (const f of Array.from(list)) {
      try {
        await upload.mutateAsync({ boardId, itemId, columnId, file: f });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Upload failed');
        return;
      }
    }
  };

  return (
    <div className="p-2 w-[320px]">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); void onUpload(e.dataTransfer.files); }}
        className={cn(
          'border border-dashed rounded-base text-center text-xs py-3 px-2 mb-2',
          dragging ? 'border-brand bg-selected' : 'border-border-medium text-text-secondary',
        )}
      >
        <Upload className="h-4 w-4 mx-auto mb-1" />
        Drop files or
        <button onClick={() => inputRef.current?.click()} className="ml-1 text-brand hover:underline">browse</button>
        <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => { void onUpload(e.target.files); e.target.value = ''; }} />
        {upload.isPending && <p className="mt-1 inline-flex items-center gap-1"><Spinner className="h-3 w-3" /> Uploading…</p>}
      </div>
      {files.length === 0 ? (
        <p className="text-[11px] text-text-disabled text-center py-2">No files yet</p>
      ) : (
        <ul className="space-y-1 max-h-[200px] overflow-y-auto">
          {files.map((f) => (
            <FilePopoverRow key={f.id} file={f} onDelete={() => del.mutateAsync(f).catch((e) => toast.error(e instanceof Error ? e.message : 'Delete failed'))} canDelete={!!profile && (profile.id === f.uploader_id || profile.role === 'admin' || profile.is_super_admin)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FilePopoverRow({ file, onDelete, canDelete }: { file: FileRow; onDelete: () => Promise<unknown>; canDelete: boolean }) {
  const { data: url } = useFileUrl(file.storage_path);
  return (
    <li className="flex items-center gap-2 px-1 py-1 rounded-sm hover:bg-hover">
      {file.mime_type.startsWith('image/') && url ? (
        <img src={url} alt={file.file_name} className="h-6 w-6 rounded-sm object-cover" />
      ) : (
        <Paperclip className="h-3.5 w-3.5 text-text-secondary" />
      )}
      <a
        href={url ?? '#'}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-1 min-w-0 text-xs truncate hover:text-brand"
      >
        {file.file_name}
      </a>
      {canDelete && (
        <button
          type="button"
          aria-label="Delete"
          onClick={() => void onDelete()}
          className="h-5 w-5 inline-flex items-center justify-center rounded-sm text-text-secondary hover:bg-error/10 hover:text-error"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </li>
  );
}
