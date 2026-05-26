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
 */
import { useEffect, useState } from 'react';
import { Check, Plus, Settings } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ColumnLabelRow, ColumnRow } from '@/lib/database.types';
import { useCreateLabel } from '@/hooks/labels';
import { chipColorFor } from '@/lib/chipColor';
import {
  defaultLabelHexFor, tokenHex, colorsEqual, type ChipToken,
} from '@/lib/colorNormalize';
import { LABEL_PALETTE } from '@/lib/labelPalette';

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

// Monday-style label palette shared with LabelsEditorModal (light +
// dark shades of each hue). See src/lib/labelPalette.ts.
const PICKER_PALETTE: readonly string[] = LABEL_PALETTE;

export function LabelPicker({
  boardId, columnId, column, labels, selectedIds, multi, onChange, onOpenLabelsEditor, onDone,
}: LabelPickerProps) {
  const create = useCreateLabel();
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  // Color the user picked (or null = use the smart default derived from
  // the current name). Re-derived live as the user types so the swatch
  // grid highlights the "current pick" sensibly.
  const [pickedColor, setPickedColor] = useState<string | null>(null);

  // Live smart-default color tracking the typed name. If the user has
  // explicitly picked a swatch, that wins; otherwise we show the
  // classifier's choice highlighted.
  const smartDefault = (() => {
    if (!newName.trim()) return PICKER_PALETTE[0];
    return defaultLabelHexFor({
      columnType: column?.column_type,
      columnName: column?.name,
      labelName:  newName.trim(),
      positionInColumn: labels.length,
      totalInColumn:    labels.length + 1,
    });
  })();
  const effectiveColor = pickedColor ?? smartDefault;

  // Reset the picker state whenever the add-flow closes/opens so we
  // don't leak a previous half-finished selection.
  useEffect(() => {
    if (!addOpen) {
      setNewName('');
      setPickedColor(null);
    }
  }, [addOpen]);

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
      // If the user explicitly picked a swatch, that wins.
      // Otherwise fall back to the smart default for the typed name.
      // If THAT smart default collides with an existing label's color,
      // rotate through the fallback palette until we find an unused
      // one so chips stay visually distinct.
      let color = effectiveColor;
      if (pickedColor == null) {
        const used = new Set(labels.map((l) => l.color.toUpperCase()));
        if (used.has(color.toUpperCase())) {
          const free = FALLBACK_ROTATION.find((t) => !used.has(tokenHex(t).toUpperCase()));
          if (free) color = tokenHex(free);
        }
      }
      await create.mutateAsync({ boardId, columnId, name: newName.trim(), color });
      // useEffect above resets newName + pickedColor when addOpen flips.
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
          className="h-9 inline-flex items-center justify-center text-[13px] font-medium text-text-secondary hover:text-text-primary"
          style={{
            // Theme-aware overlays so the picker reads correctly in
            // both themes (was rgba(255,255,255,0.X) only).
            border: '1px dashed var(--overlay-18)',
            borderRadius: 0,
            letterSpacing: '0.02em',
            background: 'transparent',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--overlay-6)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          New label
        </button>
      </div>

      {/* Inline add-label flow — only shown when the ghost cell is
          toggled on. Three elements per the spec:
            (a) name input
            (b) 8-swatch color picker (same hex palette as the editor
                modal; the smart default is highlighted automatically
                until the user clicks a swatch)
            (c) Add / Cancel buttons that actually persist on submit */}
      {addOpen && (
        <div
          className="mt-3 p-2.5 rounded-button"
          style={{
            background: 'var(--overlay-3)',
            border: '1px solid var(--overlay-6)',
          }}
        >
          <input
            type="text"
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter')  { e.preventDefault(); void onCreate(); }
              if (e.key === 'Escape') { setAddOpen(false); }
            }}
            placeholder="New label name"
            spellCheck={false}
            className="w-full h-9 px-2.5 rounded-button text-[13px] text-text-primary placeholder:text-text-secondary outline-none"
            style={{
              background: 'var(--overlay-6)',
              border: '1px solid var(--overlay-10)',
              letterSpacing: '0.02em',
            }}
          />

          {/* Preview chip + swatch grid. The preview shows the chosen
              (or smart-default) color so the user sees exactly what
              they'll get. Click any swatch to override. */}
          <div className="mt-2 flex items-center gap-2">
            <span
              aria-label="Color preview"
              className="h-7 px-2.5 inline-flex items-center text-[12px] font-medium text-white rounded-sm"
              style={{ background: effectiveColor, letterSpacing: '0.02em' }}
              title={effectiveColor}
            >
              {newName.trim() || 'preview'}
            </span>
            <span className="text-[11px] text-text-secondary">
              {pickedColor ? 'custom color' : 'smart default'}
            </span>
          </div>

          <div className="mt-2 grid grid-cols-8 gap-1.5">
            {PICKER_PALETTE.map((hex) => {
              const selected = colorsEqual(effectiveColor, hex);
              return (
                <button
                  key={hex}
                  type="button"
                  onClick={() => setPickedColor(hex)}
                  className={cn(
                    'h-6 w-6 rounded-sm inline-flex items-center justify-center transition-transform',
                    selected && 'ring-2 ring-white ring-offset-1',
                  )}
                  style={{
                    background: hex,
                  }}
                  aria-label={`Pick color ${hex}${selected ? ' (selected)' : ''}`}
                  title={hex}
                >
                  {selected && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              className="h-8 px-2.5 rounded-button text-[12px] font-medium text-text-secondary hover:bg-[var(--overlay-6)] hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void onCreate()}
              disabled={creating || !newName.trim()}
              className="h-8 px-3 rounded-button text-[12px] font-medium text-white disabled:opacity-40 inline-flex items-center gap-1 hover:brightness-110 transition-[filter] duration-100"
              style={{ background: 'var(--chip-sky)', letterSpacing: '0.02em' }}
              aria-label="Add label"
            >
              {creating ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {/* Footer — Edit Labels + (optional) Done */}
      <div
        className="mt-3 pt-2"
        style={{ borderTop: '1px solid var(--overlay-6)' }}
      >
        <button
          type="button"
          onClick={onOpenLabelsEditor}
          className="w-full h-9 inline-flex items-center justify-center gap-1.5 rounded-button text-[13px] text-text-secondary hover:bg-[var(--overlay-6)] hover:text-text-primary"
          style={{ letterSpacing: '0.02em' }}
        >
          <Settings className="h-4 w-4" />
          Edit Labels
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
