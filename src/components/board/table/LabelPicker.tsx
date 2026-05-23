/**
 * Status / Priority / Dropdown label picker — premium polish spec.
 *
 *   Container (from <Popover variant="chip">):
 *     --bg-card (#1A1D24), 12 radius, 12 padding, 0 8 32 rgba(0,0,0,0.4)
 *     + 0 0 0 1px rgba(255,255,255,0.06).
 *   Grid:
 *     2 cols, 8px gap, 320px wide.
 *   Pills:
 *     sharp corners (radius 0), full-fill chip color, white 13/500 text,
 *     36px tall, no border. Selected pill carries a faint inset ring +
 *     check mark.
 *   Footer:
 *     • "+ New label" ghost cell — dashed 1px white-12% border, opens
 *       an inline text input below.
 *     • "Edit Labels" — text button.
 *     • "✨ Auto-assign labels" — teal→purple gradient CTA (the ONLY
 *       gradient chip allowed by the polish spec).
 */
import { useState } from 'react';
import { Check, Plus, Settings, Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ColumnLabelRow, ColumnRow } from '@/lib/database.types';
import { useCreateLabel } from '@/hooks/labels';
import { chipColorFor } from '@/lib/chipColor';
import { defaultLabelHexFor, tokenHex, type ChipToken } from '@/lib/colorNormalize';

interface LabelPickerProps {
  boardId: string;
  columnId: string;
  column?: ColumnRow;          // optional — when provided we route through chipColorFor
  labels: ColumnLabelRow[];
  selectedIds: string[];
  multi: boolean;
  onChange: (ids: string[]) => void;
  onOpenLabelsEditor: () => void;
  onDone?: () => void;
}

// Fallback rotation when the label-name classifier doesn't match any
// known keyword (used by defaultLabelHexFor for generic columns).
const FALLBACK_ROTATION: ChipToken[] = [
  'mint', 'amber', 'coral', 'sky', 'purple', 'pink', 'teal', 'slate',
];

export function LabelPicker({
  boardId, columnId, column, labels, selectedIds, multi, onChange, onOpenLabelsEditor, onDone,
}: LabelPickerProps) {
  const create = useCreateLabel();
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const toggle = (id: string) => {
    if (multi) {
      onChange(
        selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id],
      );
    } else {
      onChange(selectedIds.includes(id) ? [] : [id]);
    }
  };

  // Resolve the chip color: prefer the token color when we have the
  // column context, fall back to the stored hex for custom dropdowns.
  const renderColor = (l: ColumnLabelRow, idx: number): string => {
    if (column) return chipColorFor(column, l, idx, labels.length);
    return l.color;
  };

  const onCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      // 1. Smart default: classify by label name + column type so a
      //    new "Done" seeds mint, "Stuck" seeds teal, etc.
      let color = defaultLabelHexFor({
        columnType: column?.column_type,
        columnName: column?.name,
        labelName:  newName.trim(),
        positionInColumn: labels.length,
        totalInColumn:    labels.length + 1,
      });
      // 2. If the smart default collides with an existing label's
      //    color, rotate through the fallback palette until we find an
      //    unused one — keeps the chips visually distinct.
      const used = new Set(labels.map((l) => l.color.toUpperCase()));
      if (used.has(color.toUpperCase())) {
        const free = FALLBACK_ROTATION.find((t) => !used.has(tokenHex(t).toUpperCase()));
        if (free) color = tokenHex(free);
      }
      await create.mutateAsync({ boardId, columnId, name: newName.trim(), color });
      setNewName('');
      setAddOpen(false);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="p-3 w-[320px] max-w-[calc(100vw-32px)]">
      <div className="grid grid-cols-2 gap-2">
        {labels.map((l, idx) => {
          const isSelected = selectedIds.includes(l.id);
          const bg = renderColor(l, idx);
          return (
            <button
              key={l.id}
              type="button"
              onClick={() => toggle(l.id)}
              className={cn(
                // Sharp corners (radius 0), full-fill, no border. 36px
                // tall to match the chip rule, white 13/500 text.
                'relative h-9 px-3 text-[13px] font-medium text-white inline-flex items-center justify-center text-center',
                'transition-[filter,transform] duration-75 hover:brightness-110 active:scale-[0.98]',
              )}
              style={{
                background: bg,
                borderRadius: 0,
                boxShadow: isSelected ? 'inset 0 0 0 1.5px rgba(255,255,255,0.55)' : undefined,
                letterSpacing: '0.02em',
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

        {/* "+ New label" ghost cell — dashed border, blends with the
            grid. Click expands an inline name input below the grid. */}
        <button
          type="button"
          onClick={() => setAddOpen((v) => !v)}
          aria-label="New label"
          title="New label"
          className="h-9 inline-flex items-center justify-center text-[13px] font-medium text-text-secondary hover:text-text-primary hover:bg-white/[0.05]"
          style={{
            border: '1px dashed rgba(255,255,255,0.18)',
            borderRadius: 0,
            letterSpacing: '0.02em',
          }}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          New label
        </button>
      </div>

      {/* Inline name input for the new label — only shown when the
          ghost cell is toggled on. Keeps the picker tight when not
          adding. */}
      {addOpen && (
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void onCreate(); }
              if (e.key === 'Escape') { setAddOpen(false); setNewName(''); }
            }}
            placeholder="New label name"
            spellCheck={false}
            className="flex-1 h-9 px-2.5 rounded-button text-[13px] text-text-primary placeholder:text-text-secondary outline-none"
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.08)',
              letterSpacing: '0.02em',
            }}
          />
          <button
            type="button"
            onClick={() => void onCreate()}
            disabled={creating || !newName.trim()}
            className="h-9 px-3 rounded-button text-[13px] font-medium text-white disabled:opacity-40 inline-flex items-center gap-1 hover:brightness-110 transition-[filter] duration-100"
            style={{ background: 'var(--chip-sky)', letterSpacing: '0.02em' }}
            aria-label="Add label"
          >
            Add
          </button>
        </div>
      )}

      {/* Footer — Edit Labels + Auto-assign + (optional) Done */}
      <div
        className="mt-3 pt-2"
        style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
      >
        <button
          type="button"
          onClick={onOpenLabelsEditor}
          className="w-full h-9 inline-flex items-center justify-center gap-1.5 rounded-button text-[13px] text-text-secondary hover:bg-white/[0.06] hover:text-text-primary"
          style={{ letterSpacing: '0.02em' }}
        >
          <Settings className="h-4 w-4" />
          Edit Labels
        </button>
        {/* Auto-assign — visual stub. The only gradient allowed in the
            picker per the polish spec: teal → purple. */}
        <button
          type="button"
          disabled
          title="Coming soon — AI suggests a label based on task context"
          className="w-full mt-1 h-9 inline-flex items-center justify-center gap-1.5 rounded-button text-[13px] font-medium text-white opacity-90 cursor-not-allowed"
          style={{
            background: 'linear-gradient(135deg, var(--chip-teal) 0%, var(--chip-purple) 100%)',
            letterSpacing: '0.02em',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.15)',
          }}
        >
          <Sparkles className="h-4 w-4" />
          Auto-assign labels
        </button>
        {multi && onDone && (
          <button
            type="button"
            onClick={onDone}
            className="w-full mt-2 h-9 rounded-button text-[13px] font-medium text-white hover:brightness-110 transition-[filter] duration-100"
            style={{ background: 'var(--chip-sky)' }}
          >
            Done
          </button>
        )}
      </div>
    </div>
  );
}
