import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useCreateItem } from '@/hooks/items';
import { cn } from '@/lib/cn';

interface AddItemRowProps {
  boardId: string;
  groupId: string;
  parentItemId?: string | null;
  totalWidth: number;
  placeholder?: string;
  disabled?: boolean;
}

// Pre-generated UUID for the optimistic row's id. crypto.randomUUID is
// in every modern browser; the fallback path skips the optimistic
// painting (the mutation still runs, just without instant-paint).
function freshId(): string | undefined {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return undefined;
}

export function AddItemRow({
  boardId, groupId, parentItemId, totalWidth, placeholder = '+ Add task', disabled,
}: AddItemRowProps) {
  const create = useCreateItem();
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // UI polish (batch item 4): both paths are now FIRE-AND-FORGET. We
  // clear the input + restore focus synchronously, and let the
  // optimistic onMutate inside useCreateItem paint the new row
  // immediately. Errors surface via the hook's onError toast (no
  // try/catch needed here). No more `submitting` gate — users can
  // mash "+" or hit Enter rapidly without the input disabling.
  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setName('');
    inputRef.current?.focus();
    create.mutate({
      id: freshId(),
      boardId,
      groupId,
      parentItemId: parentItemId ?? null,
      name: trimmed,
    });
  };

  // "+" button — honors typed text, falls back to "New task" when blank
  // (hook default fires when name is undefined). The DB
  // before_item_insert trigger (migration 0047) still fills task_code
  // with "Task N" regardless.
  const quickCreate = () => {
    if (disabled) return;
    const trimmed = name.trim();
    setName('');
    inputRef.current?.focus();
    create.mutate({
      id: freshId(),
      boardId,
      groupId,
      parentItemId: parentItemId ?? null,
      name: trimmed || undefined,
    });
  };

  return (
    <div
      // Premium polish: lives on canvas, single row-tall (40px), no
      // borders, no per-cell separators. Plus icon + input inherit the
      // canvas background so the whole row reads as an empty "shadow"
      // row at the bottom of the group.
      className={cn(
        // Full-width top hairline so the +Add task row clearly reads as
        // separated from the last task row above (Monday-style).
        'flex items-center h-10 bg-canvas border-t border-border-hair',
        disabled && 'opacity-50',
      )}
      style={{ minWidth: totalWidth }}
    >
      <button
        type="button"
        onClick={quickCreate}
        disabled={disabled}
        aria-label="Add task"
        title="Add task"
        className="w-10 shrink-0 flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-[var(--overlay-8)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-100"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
        placeholder={placeholder}
        disabled={disabled}
        className="flex-1 h-10 px-3 text-[13px] text-text-primary bg-transparent outline-none placeholder:text-text-secondary"
      />
    </div>
  );
}
