import { useState } from 'react';
import { Plus, ChevronDown, ChevronRight } from 'lucide-react';
import { useCreateItem } from '@/hooks/items';
import { toast } from 'sonner';
import type { ItemRow } from '@/lib/database.types';
import { cn } from '@/lib/cn';

interface SubitemsSectionProps {
  parent: ItemRow;
  subitems: ItemRow[];
  canEdit: boolean;
  onOpenSubitem: (id: string) => void;
}

export function SubitemsSection({ parent, subitems, canEdit, onOpenSubitem }: SubitemsSectionProps) {
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const create = useCreateItem();

  const onAdd = async () => {
    if (!name.trim()) return;
    setAdding(true);
    try {
      await create.mutateAsync({
        boardId: parent.board_id,
        groupId: parent.group_id,
        parentItemId: parent.id,
        name,
      });
      setName('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add subitem');
    } finally {
      setAdding(false);
    }
  };

  return (
    <section className="border-t border-border-light px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1 text-sm font-semibold text-text-primary"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Subitems
        <span className="text-text-disabled ml-1 font-normal">({subitems.length})</span>
      </button>
      {open && (
        <div className="mt-2 space-y-1">
          {subitems.map((s) => (
            <button
              key={s.id}
              onClick={() => onOpenSubitem(s.id)}
              className={cn(
                'w-full text-left px-2 py-1.5 rounded-base hover:bg-hover flex items-center gap-2',
              )}
            >
              <span className="text-xs text-text-disabled font-mono w-16 shrink-0">{s.task_code}</span>
              <span className="text-sm truncate">{s.name}</span>
            </button>
          ))}
          {canEdit && (
            <div className="flex items-center gap-2 mt-1">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !adding) void onAdd();
                  else if (e.key === 'Escape') setName('');
                }}
                placeholder="+ Add subitem"
                disabled={adding}
                className="input h-7 text-sm flex-1"
              />
              {name.trim() && (
                <button onClick={() => void onAdd()} className="btn-primary h-7 px-2 text-xs">
                  <Plus className="h-3 w-3 mr-1" /> Add
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
