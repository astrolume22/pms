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
      className={cn(
        'flex items-center border-b border-border-light bg-surface',
        disabled && 'opacity-50',
      )}
      style={{ minWidth: totalWidth }}
    >
      <div className="w-10 shrink-0 border-r border-border-light flex items-center justify-center text-text-disabled">
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
        className="flex-1 h-9 px-2 text-sm bg-transparent outline-none placeholder:text-text-disabled"
      />
    </div>
  );
}
