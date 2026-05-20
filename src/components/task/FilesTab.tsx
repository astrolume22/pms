import { useRef, useState } from 'react';
import {
  Upload, File as FileIcon, Image as ImageIcon, Trash2, Download, Paperclip,
} from 'lucide-react';
import { toast } from 'sonner';
import { useItemFiles, useUploadFile, useDeleteFile, useFileUrl } from '@/hooks/files';
import { useActiveUsers } from '@/hooks/users';
import { Avatar } from '@/components/Avatar';
import { Spinner } from '@/components/Spinner';
import { EmptyMessage } from '@/components/EmptyMessage';
import { useAuthStore } from '@/state/authStore';
import type { FileRow } from '@/lib/database.types';
import { cn } from '@/lib/cn';

interface FilesTabProps {
  boardId: string;
  itemId: string;
  canEdit: boolean;
}

export function FilesTab({ boardId, itemId, canEdit }: FilesTabProps) {
  const { data: files, isLoading } = useItemFiles(itemId);
  const upload = useUploadFile();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const onUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    for (const f of Array.from(fileList)) {
      try {
        await upload.mutateAsync({ boardId, itemId, file: f });
      } catch (err) {
        toast.error(`${f.name}: ${err instanceof Error ? err.message : 'upload failed'}`);
        return;
      }
    }
    toast.success(`Uploaded ${fileList.length} file${fileList.length === 1 ? '' : 's'}`);
  };

  return (
    <div className="space-y-3">
      {canEdit && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void onUpload(e.dataTransfer.files);
          }}
          className={cn(
            'border-2 border-dashed rounded-md py-6 px-4 text-center text-sm transition-colors duration-100',
            dragging ? 'border-brand bg-selected' : 'border-border-medium text-text-secondary',
          )}
        >
          <Upload className="h-5 w-5 mx-auto mb-2 text-text-secondary" />
          <p>Drag files here or</p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mt-1 text-brand hover:underline text-sm font-medium"
          >
            click to browse
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => { void onUpload(e.target.files); e.target.value = ''; }}
          />
          {upload.isPending && (
            <p className="mt-2 text-xs text-text-secondary inline-flex items-center gap-1">
              <Spinner className="h-3 w-3" /> Uploading…
            </p>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Spinner className="h-5 w-5 text-brand" />
        </div>
      ) : !files || files.length === 0 ? (
        <EmptyMessage title="No files" description="Drag a file in or click browse to attach one." icon={<Paperclip className="h-6 w-6" />} />
      ) : (
        <ul className="space-y-1.5">
          {files.map((f) => <FileRowItem key={f.id} file={f} />)}
        </ul>
      )}
    </div>
  );
}

function FileRowItem({ file }: { file: FileRow }) {
  const profile = useAuthStore((s) => s.profile);
  const { data: users } = useActiveUsers();
  const uploader = users?.find((u) => u.id === file.uploader_id);
  const isImage = file.mime_type.startsWith('image/');
  const { data: url } = useFileUrl(file.storage_path);
  const del = useDeleteFile();

  const isOwn = profile?.id === file.uploader_id;
  const isAdmin = profile?.role === 'admin' || profile?.is_super_admin;

  return (
    <li className="flex items-center gap-3 px-3 py-2 bg-surface border border-border-light rounded-md hover:bg-hover/30">
      <div className="h-10 w-10 shrink-0 rounded-sm bg-app flex items-center justify-center overflow-hidden">
        {isImage && url ? (
          <img src={url} alt={file.file_name} className="h-full w-full object-cover" />
        ) : isImage ? (
          <ImageIcon className="h-5 w-5 text-text-secondary" />
        ) : (
          <FileIcon className="h-5 w-5 text-text-secondary" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{file.file_name}</p>
        <p className="text-xs text-text-secondary truncate">
          {formatSize(file.file_size)}
          {uploader && <> · uploaded by @{uploader.username}</>}
          <> · {new Date(file.created_at).toLocaleDateString()}</>
        </p>
      </div>
      {uploader && <Avatar name={uploader.full_name ?? uploader.username} url={uploader.avatar_url} size="xs" />}
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="h-7 w-7 inline-flex items-center justify-center rounded-sm text-text-secondary hover:bg-hover"
          aria-label="Download"
          title="Download"
          download={file.file_name}
        >
          <Download className="h-3.5 w-3.5" />
        </a>
      )}
      {(isOwn || isAdmin) && (
        <button
          type="button"
          aria-label="Delete file"
          onClick={async () => {
            if (!window.confirm(`Delete "${file.file_name}"?`)) return;
            try {
              await del.mutateAsync(file);
              toast.success('File deleted');
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Delete failed');
            }
          }}
          className="h-7 w-7 inline-flex items-center justify-center rounded-sm text-error hover:bg-error/10"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
