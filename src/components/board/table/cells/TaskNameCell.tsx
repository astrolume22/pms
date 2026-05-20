import { useEffect, useRef, useState } from 'react';
import { ExternalLink, MessageSquare } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { useRenameItem } from '@/hooks/items';
import { cn } from '@/lib/cn';
import type { CellProps } from './cellTypes';

export function TaskNameCell({ item, boardId, readonly, isEditing, onStartEdit, onEndEdit }: CellProps) {
  const navigate = useNavigate();
  const rename = useRenameItem();
  const [draft, setDraft] = useState(item.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(item.name), [item.name]);

  useEffect(() => {
    if (isEditing) {
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [isEditing]);

  const commit = async () => {
    onEndEdit();
    const trimmed = draft.trim();
    if (!trimmed || trimmed === item.name) {
      setDraft(item.name);
      return;
    }
    try {
      await rename.mutateAsync({ id: item.id, name: trimmed, boardId });
    } catch {
      setDraft(item.name);
    }
  };

  return (
    <div
      className="group/cell flex items-center gap-1 px-2 h-full w-full"
      onClick={() => !readonly && !isEditing && onStartEdit()}
    >
      {isEditing && !readonly ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commit();
            else if (e.key === 'Escape') {
              setDraft(item.name);
              onEndEdit();
            }
          }}
          className="flex-1 min-w-0 h-7 bg-surface border border-brand rounded-sm px-1 text-sm outline-none"
          autoFocus
        />
      ) : (
        <span
          className={cn(
            'flex-1 min-w-0 text-sm font-medium truncate',
            readonly ? 'cursor-default' : 'cursor-text',
          )}
        >
          {item.name}
        </span>
      )}
      {/* Open task panel via search param */}
      <button
        type="button"
        title="Open task"
        onClick={(e) => {
          e.stopPropagation();
          navigate({
            to: '/w/$workspace/b/$boardId',
            params: { workspace: 'main', boardId },
            search: { p: item.id },
          });
        }}
        className="opacity-0 group-hover/cell:opacity-100 h-6 w-6 inline-flex items-center justify-center rounded-sm text-text-secondary hover:bg-hover"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title="View updates"
        onClick={(e) => {
          e.stopPropagation();
          navigate({
            to: '/w/$workspace/b/$boardId',
            params: { workspace: 'main', boardId },
            search: { p: item.id },
          });
        }}
        className="opacity-0 group-hover/cell:opacity-100 inline-flex items-center gap-0.5 text-xs text-text-secondary px-1 rounded-sm hover:bg-hover"
      >
        <MessageSquare className="h-3 w-3" />
        <span>·</span>
      </button>
    </div>
  );
}
