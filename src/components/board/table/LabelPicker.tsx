import { useState } from 'react';
import { Check, Plus, Settings } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ColumnLabelRow } from '@/lib/database.types';
import { useCreateLabel } from '@/hooks/labels';

interface LabelPickerProps {
  boardId: string;
  columnId: string;
  labels: ColumnLabelRow[];
  selectedIds: string[];
  multi: boolean;
  onChange: (ids: string[]) => void;
  onOpenLabelsEditor: () => void;
}

export function LabelPicker({
  boardId, columnId, labels, selectedIds, multi, onChange, onOpenLabelsEditor,
}: LabelPickerProps) {
  const create = useCreateLabel();
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const toggle = (id: string) => {
    if (multi) {
      onChange(
        selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id],
      );
    } else {
      onChange(selectedIds.includes(id) ? [] : [id]);
    }
  };

  const onCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      // Pick a color the user hasn't used yet, falling back to brand blue.
      const used = new Set(labels.map((l) => l.color));
      const palette = ['#00C875', '#FDAB3D', '#E2445C', '#A25DDC', '#0086C0', '#579BFC', '#FF158A', '#9CD326'];
      const color = palette.find((c) => !used.has(c)) ?? '#0073EA';
      await create.mutateAsync({ boardId, columnId, name: newName, color });
      setNewName('');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="p-2 w-[260px]">
      <div className="grid grid-cols-2 gap-1.5">
        {labels.map((l) => {
          const isSelected = selectedIds.includes(l.id);
          return (
            <button
              key={l.id}
              type="button"
              onClick={() => toggle(l.id)}
              className={cn(
                'h-7 px-2 rounded-base text-xs font-medium text-white inline-flex items-center justify-between gap-1 truncate',
                isSelected && 'ring-2 ring-text-primary ring-offset-1 ring-offset-surface',
              )}
              style={{ background: l.color }}
            >
              <span className="truncate">{l.name}</span>
              {isSelected && <Check className="h-3 w-3 shrink-0" />}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex gap-1">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void onCreate();
            }
          }}
          placeholder="New label name"
          className="flex-1 input h-7 text-xs"
        />
        <button
          type="button"
          onClick={() => void onCreate()}
          disabled={creating || !newName.trim()}
          className="h-7 px-2 rounded-base bg-brand text-white text-xs font-medium hover:bg-brand-hover disabled:opacity-40"
          aria-label="Add label"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <button
        type="button"
        onClick={onOpenLabelsEditor}
        className="mt-2 w-full h-7 inline-flex items-center justify-center gap-1 rounded-base text-xs text-text-secondary hover:bg-hover"
      >
        <Settings className="h-3.5 w-3.5" />
        Edit Labels
      </button>
    </div>
  );
}
