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
      // Task-name is the only "wide" cell that is NOT a chip — transparent
      // background, plain 13/400 white text, left-aligned. Hover gives the
      // 8% white overlay; focus the 2px chip-sky inset ring (chunk 13).
      tabIndex={readonly ? -1 : 0}
      role={readonly ? undefined : 'button'}
      className="cell-focusable group/cell flex items-center h-full w-full px-4 hover:bg-[var(--overlay-8)] transition-colors duration-100"
      onClick={() => !readonly && !isEditing && onStartEdit()}
      onKeyDown={(e) => {
        if (readonly || isEditing) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onStartEdit(); }
      }}
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
          className="flex-1 min-w-0 h-8 bg-transparent border-b border-chip-sky px-0 text-[13px] text-text-primary outline-none"
          autoFocus
        />
      ) : (
        <span
          className={cn(
            'flex-1 min-w-0 text-[13px] text-text-primary truncate',
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
