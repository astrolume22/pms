/**
 * Status / Priority / Dropdown label picker — the popover that opens
 * when an admin clicks a label cell. Premium spec:
 *   - 2-column grid of full-bleed colored chips, 8px gap, ~36px tall.
 *   - Selected chip shows a thin white check on the right + a faint
 *     1px inner ring (rgba(255,255,255,0.4)).
 *   - "+ Add label" lives ONLY in the bottom row (input + Add button) —
 *     no placeholder chip in the grid.
 *   - Footer: "Edit Labels" + "Auto-assign labels" (sparkle, stub).
 *   - Done button still appears in multi-select mode so the user can
 *     close the popover after toggling many labels.
 *
 * The popover's outer chrome (background #31314D, 8px corners, hairline
 * border, drop shadow, upward caret) is provided by `Popover` with
 * variant="chip" — this component just renders the inner content.
 */
import { useState } from 'react';
import { Check, Plus, Settings, Sparkles } from 'lucide-react';
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
  onDone?: () => void;
}

// Premium chip-color palette used when the admin types a new label
// name and clicks Add. Picks the next color not already in use on this
// column so chips read as distinct at a glance.
const PALETTE = [
  '#4CD297', '#F64F9F', '#FDBB71', '#F68A5C', '#E16E7F',
  '#7BB0F6', '#777E91', '#C26175', '#419DCC', '#B280DF',
  '#FF3D8B', '#6646A7', '#51458F', '#3E3A6B',
  '#71BCA5', '#3DA0CA', '#B17FE0', '#265565',
];

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
      const used = new Set(labels.map((l) => l.color));
      const color = PALETTE.find((c) => !used.has(c)) ?? '#2B7FFF';
      await create.mutateAsync({ boardId, columnId, name: newName.trim(), color });
      setNewName('');
    } finally {
      setCreating(false);
    }
  };

  return (
    // Inner container — the Popover's chip variant supplies the outer
    // chrome (bg #31314D, 8px corners, hairline border, drop shadow,
    // upward caret). Width sized for the 2-col grid.
    <div className="p-3 w-[420px] max-w-[calc(100vw-32px)]">
      <div className="grid grid-cols-2 gap-2">
        {labels.map((l) => {
          const isSelected = selectedIds.includes(l.id);
          return (
            <button
              key={l.id}
              type="button"
              onClick={() => toggle(l.id)}
              className={cn(
                'relative h-9 px-3 text-[13px] font-semibold text-white',
                'inline-flex items-center justify-center text-center',
                'transition-transform duration-75 hover:brightness-110 active:scale-[0.98]',
              )}
              style={{
                background: l.color,
                borderRadius: 5,
                // Faint 1px inner ring on the selected chip — subtle, not
                // a heavy filled badge. inset shadow renders inside the
                // rounded corners cleanly.
                boxShadow: isSelected ? 'inset 0 0 0 1px rgba(255,255,255,0.4)' : undefined,
              }}
            >
              <span className="truncate">{l.name}</span>
              {isSelected && (
                <Check
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white"
                  strokeWidth={2.5}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* "+ New label" row — text input + Add button. The picker grid
          never holds a fake placeholder chip; new labels start here. */}
      <div className="mt-3 flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void onCreate(); }
          }}
          placeholder="New label name"
          spellCheck={false}
          className="flex-1 h-9 px-2.5 rounded-base text-[13px] text-white placeholder-white/50 outline-none focus:ring-2 focus:ring-brand/60"
          style={{
            background: '#3A3F5A',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
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

      {/* Footer — Edit Labels + Auto-assign + (optional) Done */}
      <div
        className="mt-3 pt-2"
        style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}
      >
        <button
          type="button"
          onClick={onOpenLabelsEditor}
          className="w-full h-8 inline-flex items-center justify-center gap-1.5 rounded-base text-[13px] text-white/75 hover:bg-white/[0.06] hover:text-white"
        >
          <Settings className="h-4 w-4" />
          Edit Labels
        </button>
        {/* Auto-assign labels — visual stub for now; the wiring will
            land later (Gemini-driven suggestion based on task context). */}
        <button
          type="button"
          disabled
          title="Coming soon — AI suggests a label based on task context"
          className="w-full h-8 inline-flex items-center justify-center gap-1.5 rounded-base text-[13px] text-white/60 hover:bg-white/[0.04] cursor-not-allowed"
        >
          <Sparkles className="h-4 w-4 text-brand" />
          Auto-assign labels
        </button>
        {multi && onDone && (
          <button
            type="button"
            onClick={onDone}
            className="w-full mt-2 h-8 rounded-base bg-brand text-white text-[13px] font-medium hover:bg-brand-hover"
          >
            Done
          </button>
        )}
      </div>
    </div>
  );
}
