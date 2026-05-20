import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useCreateGroup } from '@/hooks/groups';
import { toast } from 'sonner';

interface AddGroupRowProps {
  boardId: string;
  disabled?: boolean;
}

export function AddGroupRow({ boardId, disabled }: AddGroupRowProps) {
  const create = useCreateGroup();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await create.mutateAsync({ boardId, name });
      setName('');
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create group');
    } finally {
      setSubmitting(false);
    }
  };

  if (open) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-surface border border-border-light rounded-md">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !submitting) void submit();
            else if (e.key === 'Escape') { setName(''); setOpen(false); }
          }}
          placeholder="Group name"
          className="input h-8 text-sm flex-1 max-w-[280px]"
        />
        <button onClick={() => void submit()} disabled={!name.trim() || submitting} className="btn-primary h-8 px-3 text-xs">Create</button>
        <button onClick={() => { setName(''); setOpen(false); }} className="btn-ghost h-8 px-2 text-xs">Cancel</button>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setOpen(true)}
      className="text-sm text-text-secondary hover:text-text-primary inline-flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <Plus className="h-3.5 w-3.5" />
      Add new group
    </button>
  );
}
