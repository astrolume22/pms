import { useEffect, useRef, useState } from 'react';
import { Plus, LayoutGrid, FileText, BarChart3, Folder } from 'lucide-react';
import { cn } from '@/lib/cn';

interface AddNewMenuProps {
  onCreateBoard: () => void;
  canCreate: boolean;
}

export function AddNewMenu({ onCreateBoard, canCreate }: AddNewMenuProps) {
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
        className={cn(
          'w-full flex items-center justify-center gap-1 h-8 rounded-base text-sm font-medium',
          'bg-surface border border-border-medium hover:bg-hover transition-colors duration-100',
          'disabled:opacity-40 disabled:cursor-not-allowed',
        )}
        disabled={!canCreate}
        title={canCreate ? 'Add new' : 'Viewers cannot create boards'}
      >
        <Plus className="h-4 w-4" />
        <span>Add new</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 right-0 bottom-9 z-40 bg-surface border border-border-light rounded-md shadow-lg overflow-hidden"
        >
          <Option
            icon={<LayoutGrid className="h-4 w-4" />}
            label="Board"
            description="A grid of tasks"
            onClick={() => {
              setOpen(false);
              onCreateBoard();
            }}
          />
          <Option icon={<BarChart3 className="h-4 w-4" />} label="Dashboard" badge="V2" disabled />
          <Option icon={<FileText className="h-4 w-4" />}  label="Doc"       badge="V2" disabled />
          <Option icon={<Folder className="h-4 w-4" />}    label="Folder"    badge="V2" disabled />
        </div>
      )}
    </div>
  );
}

function Option({
  icon, label, description, onClick, disabled, badge,
}: {
  icon: React.ReactNode;
  label: string;
  description?: string;
  onClick?: () => void;
  disabled?: boolean;
  badge?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'w-full text-left px-3 py-2 text-sm flex items-center gap-3',
        'hover:bg-hover disabled:opacity-40 disabled:cursor-not-allowed',
      )}
    >
      <span className="text-text-secondary">{icon}</span>
      <span className="flex-1">
        <span className="block">{label}</span>
        {description && <span className="block text-xs text-text-secondary">{description}</span>}
      </span>
      {badge && (
        <span className="text-[10px] uppercase tracking-wide text-text-disabled border border-border-light px-1.5 py-0.5 rounded-sm">
          {badge}
        </span>
      )}
    </button>
  );
}
