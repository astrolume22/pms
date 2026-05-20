import { useEffect, useState } from 'react';
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

const COLOR_PALETTE = [
  '#00C875', '#E2445C', '#FDAB3D', '#FFCB00', '#A25DDC', '#784BD1',
  '#0086C0', '#579BFC', '#037F4C', '#0F5662', '#FF158A', '#FF6E92',
  '#9CD326', '#C4C4C4', '#808080', '#7E3B08', '#FF7575', '#225091',
];

interface LabelsEditorModalProps {
  open: boolean;
  onClose: () => void;
  boardId: string;
  column: ColumnRow;
}

export function LabelsEditorModal({ open, onClose, boardId, column }: LabelsEditorModalProps) {
  const { data: labelsMap } = useColumnLabels(boardId);
  const labels: ColumnLabelRow[] = (labelsMap?.get(column.id) ?? []).slice().sort(
    (a, b) => a.sort_order - b.sort_order,
  );

  const create = useCreateLabel();
  const update = useUpdateLabel();
  const remove = useDeleteLabel();
  const setDefault = useSetDefaultLabel();
  const reorder = useReorderLabels();

  // local working copy — apply on Save
  const [working, setWorking] = useState<ColumnLabelRow[]>(labels);
  useEffect(() => {
    if (open) setWorking(labels);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, labelsMap]);

  const onSave = async () => {
    try {
      // Apply renames / color changes
      for (const cur of working) {
        const original = labels.find((l) => l.id === cur.id);
        if (!original) continue;
        const patch: Record<string, unknown> = {};
        if (cur.name !== original.name) patch.name = cur.name;
        if (cur.color !== original.color) patch.color = cur.color;
        if (Object.keys(patch).length > 0) {
          await update.mutateAsync({ id: cur.id, columnId: column.id, boardId, patch });
        }
      }
      // Reorder if needed
      const orderChanged =
        working.length === labels.length && working.some((w, i) => w.id !== labels[i].id);
      if (orderChanged) {
        await reorder.mutateAsync({
          boardId, columnId: column.id, orderedIds: working.map((w) => w.id),
        });
      }
      toast.success('Labels updated');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save labels');
    }
  };

  const onAdd = async () => {
    try {
      await create.mutateAsync({
        boardId, columnId: column.id, name: 'New label', color: '#0073EA',
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add label');
    }
  };

  const move = (idx: number, dir: -1 | 1) => {
    setWorking((prev) => {
      const next = prev.slice();
      const dst = idx + dir;
      if (dst < 0 || dst >= next.length) return prev;
      [next[idx], next[dst]] = [next[dst], next[idx]];
      return next;
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit labels — ${column.name}`}
      size="md"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => void onSave()}>Apply</button>
        </>
      }
    >
      <div className="space-y-2">
        {working.map((l, idx) => (
          <div
            key={l.id}
            className="flex items-center gap-2 border border-border-light rounded-base p-2 bg-app/40"
          >
            {/* Reorder buttons (keyboard-friendly substitute for drag) */}
            <div className="flex flex-col">
              <button
                type="button"
                onClick={() => move(idx, -1)}
                disabled={idx === 0}
                className="h-3 text-text-disabled hover:text-text-primary disabled:opacity-30"
                aria-label="Move up"
              >▲</button>
              <button
                type="button"
                onClick={() => move(idx, 1)}
                disabled={idx === working.length - 1}
                className="h-3 text-text-disabled hover:text-text-primary disabled:opacity-30"
                aria-label="Move down"
              >▼</button>
            </div>

            {/* Pill preview + inline rename */}
            <input
              value={l.name}
              onChange={(e) =>
                setWorking((prev) => prev.map((x) => (x.id === l.id ? { ...x, name: e.target.value } : x)))
              }
              className="flex-1 h-7 px-2 rounded-base text-xs font-medium text-white outline-none border-none"
              style={{ background: l.color }}
            />

            {/* Color picker */}
            <ColorSwatch
              value={l.color}
              onChange={(c) =>
                setWorking((prev) => prev.map((x) => (x.id === l.id ? { ...x, color: c } : x)))
              }
            />

            {/* Default */}
            <button
              type="button"
              title={l.is_default ? 'Default label' : 'Set as default'}
              onClick={async () => {
                if (l.is_default) return;
                try {
                  await setDefault.mutateAsync({ id: l.id, columnId: column.id, boardId });
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Failed');
                }
              }}
              className={cn(
                'h-6 w-6 inline-flex items-center justify-center rounded-sm',
                l.is_default ? 'text-warning' : 'text-text-disabled hover:text-text-primary',
              )}
            >
              <Star className={cn('h-3.5 w-3.5', l.is_default && 'fill-warning')} />
            </button>

            {/* Delete */}
            <button
              type="button"
              onClick={async () => {
                if (!window.confirm(`Delete label "${l.name}"? Items using it will lose this label.`)) return;
                try {
                  await remove.mutateAsync({ id: l.id, columnId: column.id, boardId });
                  setWorking((prev) => prev.filter((x) => x.id !== l.id));
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Delete failed');
                }
              }}
              className="h-6 w-6 inline-flex items-center justify-center rounded-sm text-error hover:bg-error/10"
              aria-label="Delete label"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={() => void onAdd()}
          className="w-full h-9 inline-flex items-center justify-center gap-1 rounded-base border border-dashed border-border-medium text-sm text-text-secondary hover:bg-hover"
        >
          <Plus className="h-4 w-4" />
          New label
        </button>
      </div>
    </Modal>
  );
}

function ColorSwatch({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-6 w-6 rounded-sm border border-border-medium"
        style={{ background: value }}
        aria-label="Pick color"
      />
      {open && (
        <div
          className="absolute top-7 right-0 z-50 bg-surface border border-border-light rounded-md shadow-lg p-2 grid grid-cols-6 gap-1.5 w-[160px]"
          onMouseLeave={() => setOpen(false)}
        >
          {COLOR_PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => { onChange(c); setOpen(false); }}
              className={cn(
                'h-5 w-5 rounded-sm inline-flex items-center justify-center',
                value === c && 'ring-2 ring-text-primary ring-offset-1 ring-offset-surface',
              )}
              style={{ background: c }}
              aria-label={c}
            >
              {value === c && <Check className="h-3 w-3 text-white" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
