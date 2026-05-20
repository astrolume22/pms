import { useEffect, useRef, useState } from 'react';
import { useRenameItem } from '@/hooks/items';
import { cn } from '@/lib/cn';
import type { CellProps } from './cellTypes';

/**
 * Task name cell — inline-editable text. The task-code display and the
 * "open task panel" button now live in their own synthetic columns
 * rendered by `ItemRow`, so this cell is intentionally minimal.
 */
export function TaskNameCell({ item, boardId, readonly, isEditing, onStartEdit, onEndEdit }: CellProps) {
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
      className="group/cell flex items-center gap-1 px-3 h-full w-full"
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
          className="flex-1 min-w-0 h-8 bg-surface border border-brand rounded-sm px-1 text-[14px] outline-none"
          autoFocus
        />
      ) : (
        <span
          className={cn(
            'flex-1 min-w-0 text-[14px] truncate',
            readonly ? 'cursor-default' : 'cursor-text',
          )}
          title={item.name}
        >
          {item.name}
        </span>
      )}
    </div>
  );
}
