import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useCreateItem } from '@/hooks/items';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';

interface AddItemRowProps {
  boardId: string;
  groupId: string;
  parentItemId?: string | null;
  totalWidth: number;
  placeholder?: string;
  disabled?: boolean;
}

export function AddItemRow({
  boardId, groupId, parentItemId, totalWidth, placeholder = '+ Add task', disabled,
}: AddItemRowProps) {
  const create = useCreateItem();
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await create.mutateAsync({ boardId, groupId, parentItemId: parentItemId ?? null, name: trimmed });
      setName('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create task');
    } finally {
      setSubmitting(false);
    }
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
      <div className="w-10 shrink-0 flex items-center justify-center text-text-secondary">
        <Plus className="h-3.5 w-3.5" />
      </div>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !submitting) void submit();
        }}
        placeholder={placeholder}
        disabled={disabled || submitting}
        className="flex-1 h-10 px-3 text-[13px] text-text-primary bg-transparent outline-none placeholder:text-text-secondary"
      />
    </div>
  );
}
