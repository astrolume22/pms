import { Plus, Table2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export function BoardTabs() {
  return (
    <div className="px-8 border-b border-border-light bg-surface flex items-center gap-1">
      <Tab active icon={<Table2 className="h-3.5 w-3.5" />} label="Main table" />
      <button
        type="button"
        className="ml-1 h-7 w-7 inline-flex items-center justify-center rounded-sm text-text-secondary hover:bg-hover disabled:opacity-40"
        disabled
        title="Add view — Phase 5"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

function Tab({ active, icon, label }: { active?: boolean; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      className={cn(
        'h-9 px-3 -mb-px text-sm font-medium flex items-center gap-1.5 border-b-2 transition-colors duration-100',
        active ? 'border-brand text-brand' : 'border-transparent text-text-secondary hover:text-text-primary',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
