import { useEffect, useRef, useState } from 'react';
import {
  Plus, Type, AlignLeft, Hash, CheckSquare, Flag, Calendar, User, List, Link as LinkIcon, ListChecks,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ColumnType } from '@/lib/database.types';
import { useCreateColumn } from '@/hooks/columns';
import { toast } from 'sonner';

type AddableType = Exclude<ColumnType, 'task_name'>;

interface Group { label: string; items: { type: AddableType; label: string; icon: React.ReactNode; description: string }[] }

const TYPES: Group[] = [
  {
    label: 'Essentials',
    items: [
      { type: 'text',     label: 'Text',     icon: <Type className="h-4 w-4" />,      description: 'Free-form notes' },
      { type: 'numbers',  label: 'Numbers',  icon: <Hash className="h-4 w-4" />,      description: 'Numeric value' },
      { type: 'checkbox', label: 'Checkbox', icon: <CheckSquare className="h-4 w-4" />, description: 'Done / not done' },
    ],
  },
  {
    label: 'Labels',
    items: [
      { type: 'status',   label: 'Status',   icon: <Flag className="h-4 w-4" />,      description: 'Single colored label' },
      { type: 'priority', label: 'Priority', icon: <AlignLeft className="h-4 w-4" />, description: 'Low / Medium / High / Critical' },
      { type: 'dropdown', label: 'Dropdown', icon: <ListChecks className="h-4 w-4" />, description: 'Multi-select tags' },
    ],
  },
  {
    label: 'People',
    items: [
      { type: 'people',   label: 'Person',   icon: <User className="h-4 w-4" />, description: 'Assign teammates' },
    ],
  },
  {
    label: 'Other',
    items: [
      { type: 'date',     label: 'Date',     icon: <Calendar className="h-4 w-4" />, description: 'Pick a date' },
      { type: 'link',     label: 'Link',     icon: <LinkIcon className="h-4 w-4" />, description: 'URL + display text' },
    ],
  },
];

const ICON: Record<AddableType, React.ReactNode> = {
  text:     <Type className="h-4 w-4" />,
  numbers:  <Hash className="h-4 w-4" />,
  checkbox: <CheckSquare className="h-4 w-4" />,
  status:   <Flag className="h-4 w-4" />,
  priority: <AlignLeft className="h-4 w-4" />,
  dropdown: <ListChecks className="h-4 w-4" />,
  people:   <User className="h-4 w-4" />,
  date:     <Calendar className="h-4 w-4" />,
  link:     <LinkIcon className="h-4 w-4" />,
};

interface AddColumnMenuProps {
  boardId: string;
  disabled?: boolean;
}

export function AddColumnMenu({ boardId, disabled }: AddColumnMenuProps) {
  const create = useCreateColumn();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="h-9 w-9 inline-flex items-center justify-center rounded-sm text-text-secondary hover:bg-hover disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label="Add column"
        title="Add column"
      >
        <Plus className="h-4 w-4" />
      </button>
      {open && (
        <div
          className="absolute left-0 top-10 z-30 bg-surface border border-border-light rounded-md shadow-lg overflow-hidden w-[300px] max-h-[400px] overflow-y-auto"
        >
          {TYPES.map((g) => (
            <div key={g.label} className="py-1">
              <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-text-disabled font-medium">{g.label}</div>
              {g.items.map((it) => (
                <button
                  key={it.type}
                  type="button"
                  onClick={async () => {
                    setOpen(false);
                    try {
                      await create.mutateAsync({ boardId, type: it.type });
                      toast.success(`${it.label} column added`);
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'Add column failed');
                    }
                  }}
                  className={cn(
                    'w-full text-left px-3 py-1.5 inline-flex items-center gap-2 hover:bg-hover text-sm',
                  )}
                >
                  <span className="text-text-secondary">{ICON[it.type]}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block">{it.label}</span>
                    <span className="block text-xs text-text-secondary">{it.description}</span>
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
