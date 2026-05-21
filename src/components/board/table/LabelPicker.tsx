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
  // Multi-select pickers stay open while you toggle; "Done" tells us the
  // user is finished so we can close the popover.
  onDone?: () => void;
}

export function LabelPicker({
  boardId, columnId, labels, selectedIds, multi, onChange, onOpenLabelsEditor, onDone,
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
      // Pick a color the user hasn't used yet from the Monday-night chip
      // palette (status / task-type / time / priority / accent groups).
      const used = new Set(labels.map((l) => l.color));
      const palette = [
        '#F8BD6D', '#787F92', '#D0728A', '#33C481',   // status row
        '#3DA0CA', '#1F5A62', '#B17FE0', '#265565',   // task-type row
        '#F9885E', '#7DAFF8', '#F74EA1', '#459CC7', '#71BCA5', // time/effort
        '#6646A7', '#51458F', '#3E3A6B',              // priority ramp
        '#FF3D8B',                                    // accent
      ];
      const color = palette.find((c) => !used.has(c)) ?? '#2B7FFF';
      await create.mutateAsync({ boardId, columnId, name: newName, color });
      setNewName('');
    } finally {
      setCreating(false);
    }
  };

  // Monday-style roomy popover. Big colored buttons in a 2-column grid,
  // ~210px wide × 36px tall each, white centered text, no ring outline on
  // selected — Monday uses a check overlay only. "Edit Labels" footer
  // mirrors Monday's pencil row, full-width and underlined-on-hover.
  return (
    <div className="p-3 w-[480px] max-w-[calc(100vw-32px)]">
      <div className="grid grid-cols-2 gap-2">
        {labels.map((l) => {
          const isSelected = selectedIds.includes(l.id);
          return (
            <button
              key={l.id}
              type="button"
              onClick={() => toggle(l.id)}
              className={cn(
                'relative h-9 px-3 rounded-base text-[13px] font-semibold text-white inline-flex items-center justify-center gap-2',
                'transition-transform duration-75 hover:brightness-110 active:scale-[0.98]',
                isSelected && 'outline outline-2 outline-white/70',
              )}
              style={{ background: l.color }}
            >
              <span className="truncate text-center">{l.name}</span>
              {isSelected && <Check className="h-3.5 w-3.5 shrink-0 absolute right-2 top-1/2 -translate-y-1/2" />}
            </button>
          );
        })}
      </div>

      {/* Inline create row */}
      <div className="mt-3 flex gap-2">
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
          className="flex-1 input h-9 text-[13px]"
        />
        <button
          type="button"
          onClick={() => void onCreate()}
          disabled={creating || !newName.trim()}
          className="h-9 px-3 rounded-base bg-brand text-white text-[13px] font-medium hover:bg-brand-hover disabled:opacity-40 inline-flex items-center gap-1"
          aria-label="Add label"
        >
          <Plus className="h-4 w-4" /> Add
        </button>
      </div>

      {/* Footer — Edit Labels + (optional) Done */}
      <div className="mt-3 pt-3 border-t border-border-light flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onOpenLabelsEditor}
          className="flex-1 h-8 inline-flex items-center justify-center gap-1.5 rounded-base text-[13px] text-text-secondary hover:bg-hover hover:text-text-primary"
        >
          <Settings className="h-4 w-4" />
          Edit Labels
        </button>
        {multi && onDone && (
          <button
            type="button"
            onClick={onDone}
            className="h-8 px-4 rounded-base bg-brand text-white text-[13px] font-medium hover:bg-brand-hover"
          >
            Done
          </button>
        )}
      </div>
    </div>
  );
}
