/**
 * Labels editor — admin only (per docs/PERMISSIONS-REDESIGN-PLAN.md).
 *
 * Matches Monday's label manager:
 *   - Grid of colored label chips, each one inline-editable.
 *   - Swatch tile on the right opens a 18-color picker; click to recolor.
 *   - Reorder via up/down arrows on the left.
 *   - Trash icon deletes immediately.
 *   - "+ New label" adds a fresh row using the next unused palette
 *     color, then focuses the new row's name input so the admin can
 *     type a name in one motion. No "Apply" friction — every edit
 *     auto-saves on blur / click. The Close button just dismisses
 *     the modal.
 */
import { useEffect, useRef, useState } from 'react';
import { Trash2, Check, Plus, Star } from 'lucide-react';
import { Modal } from '@/components/Modal';
import {
  useColumnLabels,
  useCreateLabel,
  useUpdateLabel,
  useDeleteLabel,
  useSetDefaultLabel,
  useReorderLabels,
} from '@/hooks/labels';
import type { ColumnLabelRow, ColumnRow } from '@/lib/database.types';
import { cn } from '@/lib/cn';
import { toast } from 'sonner';

// Premium polish chip palette — the 8 OKLCH tokens precomputed to hex
// via colorNormalize so every label written from the editor lands in
// the canonical #RRGGBB form that the renderer reads back verbatim.
// (Earlier this file wrote oklch() strings; the renderer's name-based
// override hid the disagreement, but it broke string-equality and the
// "selected color" highlight on the swatch. Hex everywhere now.)
import { TOKEN_HEX, colorsEqual, toCanonicalHex } from '@/lib/colorNormalize';
const COLOR_PALETTE: string[] = [
  TOKEN_HEX.amber,
  TOKEN_HEX.slate,
  TOKEN_HEX.teal,
  TOKEN_HEX.pink,
  TOKEN_HEX.purple,
  TOKEN_HEX.sky,
  TOKEN_HEX.mint,
  TOKEN_HEX.coral,
];

interface LabelsEditorModalProps {
  open: boolean;
  onClose: () => void;
  boardId: string;
  column: ColumnRow;
}

export function LabelsEditorModal({ open, onClose, boardId, column }: LabelsEditorModalProps) {
  const { data: labelsMap } = useColumnLabels(boardId);
  const labels: ColumnLabelRow[] = (labelsMap?.get(column.id) ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);

  const create = useCreateLabel();
  const update = useUpdateLabel();
  const remove = useDeleteLabel();
  const setDefault = useSetDefaultLabel();
  const reorder = useReorderLabels();

  // After "+ New label", we want the new row's input focused. Track
  // the most-recently-created id and let LabelRow pick it up.
  const [focusId, setFocusId] = useState<string | null>(null);

  const onAdd = async () => {
    try {
      // Match the LabelPicker create flow: smart default by name +
      // column type, fall back to first unused palette color.
      const { defaultLabelHexFor } = await import('@/lib/colorNormalize');
      let color = defaultLabelHexFor({
        columnType: column.column_type,
        columnName: column.name,
        labelName:  'New label',
        positionInColumn: labels.length,
        totalInColumn:    labels.length + 1,
      });
      const used = new Set(labels.map((l) => toCanonicalHex(l.color).toUpperCase()));
      if (used.has(color.toUpperCase())) {
        const free = COLOR_PALETTE.find((c) => !used.has(c.toUpperCase()));
        if (free) color = free;
      }
      const created = await create.mutateAsync({
        boardId, columnId: column.id, name: 'New label', color,
      });
      setFocusId(created.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add label');
    }
  };

  const onMove = async (idx: number, dir: -1 | 1) => {
    const dst = idx + dir;
    if (dst < 0 || dst >= labels.length) return;
    const next = labels.slice();
    [next[idx], next[dst]] = [next[dst], next[idx]];
    try {
      await reorder.mutateAsync({
        boardId, columnId: column.id, orderedIds: next.map((l) => l.id),
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reorder');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit labels — ${column.name}`}
      size="md"
      footer={
        <button className="btn-primary" onClick={onClose}>Done</button>
      }
    >
      <div className="space-y-2">
        {labels.length === 0 && (
          <p className="text-sm text-text-secondary text-center py-4">
            No labels yet. Click <span className="font-medium text-text-primary">+ New label</span> below to add the first one.
          </p>
        )}

        {labels.map((label, idx) => (
          <LabelRow
            key={label.id}
            label={label}
            isFirst={idx === 0}
            isLast={idx === labels.length - 1}
            shouldFocus={focusId === label.id}
            onConsumeFocus={() => setFocusId(null)}
            onRename={async (name) => {
              if (name === label.name) return;
              try {
                await update.mutateAsync({
                  id: label.id, columnId: column.id, boardId,
                  patch: { name },
                });
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Rename failed');
              }
            }}
            onColorChange={async (color) => {
              try {
                await update.mutateAsync({
                  id: label.id, columnId: column.id, boardId,
                  // Coerce to canonical hex so the DB stays uniform even
                  // if a caller (or a future palette extension) sends a
                  // non-hex value.
                  patch: { color: toCanonicalHex(color) },
                });
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Color change failed');
              }
            }}
            onSetDefault={async () => {
              if (label.is_default) return;
              try {
                await setDefault.mutateAsync({ id: label.id, columnId: column.id, boardId });
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Could not set default');
              }
            }}
            onDelete={async () => {
              if (!window.confirm(`Delete label "${label.name}"? Items using it will lose this label.`)) return;
              try {
                await remove.mutateAsync({ id: label.id, columnId: column.id, boardId });
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Delete failed');
              }
            }}
            onMoveUp={() => void onMove(idx, -1)}
            onMoveDown={() => void onMove(idx, 1)}
          />
        ))}

        <button
          type="button"
          onClick={() => void onAdd()}
          disabled={create.isPending}
          className="w-full h-10 inline-flex items-center justify-center gap-1.5 rounded-base border border-dashed border-border-medium text-sm font-medium text-text-secondary hover:bg-hover hover:text-text-primary disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          {create.isPending ? 'Adding…' : 'New label'}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// Individual editable label row. Inline name input + color swatch +
// default-star + delete. All edits auto-save (no Apply button).
// ---------------------------------------------------------------------
function LabelRow({
  label, isFirst, isLast, shouldFocus, onConsumeFocus,
  onRename, onColorChange, onSetDefault, onDelete, onMoveUp, onMoveDown,
}: {
  label: ColumnLabelRow;
  isFirst: boolean;
  isLast: boolean;
  shouldFocus: boolean;
  onConsumeFocus: () => void;
  onRename: (name: string) => Promise<void>;
  onColorChange: (color: string) => Promise<void>;
  onSetDefault: () => Promise<void>;
  onDelete: () => Promise<void>;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const [draft, setDraft] = useState(label.name);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => setDraft(label.name), [label.name]);
  useEffect(() => {
    if (shouldFocus && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
      onConsumeFocus();
    }
  }, [shouldFocus, onConsumeFocus]);

  const commit = async () => {
    const name = draft.trim();
    if (!name) { setDraft(label.name); return; }
    await onRename(name);
  };

  return (
    <div className="flex items-center gap-2 border border-border-light rounded-base p-1.5 bg-app/40">
      {/* Reorder up/down */}
      <div className="flex flex-col">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={isFirst}
          className="h-3 text-text-disabled hover:text-text-primary disabled:opacity-30"
          aria-label="Move up"
        >▲</button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={isLast}
          className="h-3 text-text-disabled hover:text-text-primary disabled:opacity-30"
          aria-label="Move down"
        >▼</button>
      </div>

      {/* Colored chip — the input lives inside, white text, background = label color */}
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); }
          else if (e.key === 'Escape') { setDraft(label.name); (e.target as HTMLInputElement).blur(); }
        }}
        className="flex-1 h-8 px-2.5 rounded-sm text-[13px] font-semibold text-white placeholder-white/70 outline-none focus:ring-2 focus:ring-white/40"
        style={{ background: label.color }}
        placeholder="Label name"
      />

      <ColorSwatch value={label.color} onChange={onColorChange} />

      <button
        type="button"
        title={label.is_default ? 'Default label' : 'Set as default'}
        onClick={() => void onSetDefault()}
        className={cn(
          'h-7 w-7 inline-flex items-center justify-center rounded-sm',
          label.is_default ? 'text-warning' : 'text-text-disabled hover:text-text-primary',
        )}
      >
        <Star className={cn('h-4 w-4', label.is_default && 'fill-warning')} />
      </button>

      <button
        type="button"
        onClick={() => void onDelete()}
        title="Delete label"
        aria-label="Delete label"
        className="h-7 w-7 inline-flex items-center justify-center rounded-sm text-error hover:bg-error/10"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------
// 18-color swatch picker. Hover-open + click-to-select.
// ---------------------------------------------------------------------
function ColorSwatch({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-7 w-7 rounded-sm border border-border-medium"
        style={{ background: value }}
        aria-label="Pick label color"
      />
      {open && (
        <div
          className="absolute top-8 right-0 z-50 bg-surface border border-border-light rounded-md shadow-lg p-2 grid grid-cols-6 gap-1.5 w-[180px]"
          onMouseLeave={() => setOpen(false)}
        >
          {COLOR_PALETTE.map((c) => {
            // colorsEqual normalises both sides to canonical hex first —
            // so a label stored as oklch(...) or as a different-case hex
            // still gets the "currently selected" highlight.
            const selected = colorsEqual(value, c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => { onChange(c); setOpen(false); }}
                className={cn(
                  'h-6 w-6 rounded-sm inline-flex items-center justify-center',
                  selected && 'ring-2 ring-text-primary ring-offset-1 ring-offset-surface',
                )}
                style={{ background: c }}
                aria-label={c}
              >
                {selected && <Check className="h-3 w-3 text-white" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
