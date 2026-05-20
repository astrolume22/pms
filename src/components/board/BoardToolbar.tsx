import { Search, User, SlidersHorizontal, ArrowUpDown, EyeOff, Layers, Plus, ChevronDown } from 'lucide-react';

export function BoardToolbar() {
  return (
    <div className="px-8 py-3 bg-surface flex items-center gap-2 border-b border-border-light">
      <button
        type="button"
        className="inline-flex items-center gap-1 h-9 px-3 rounded-base bg-brand text-white text-sm font-medium opacity-60 cursor-not-allowed"
        disabled
        title="Tasks arrive in Phase 3"
      >
        New task
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      <div className="h-5 w-px bg-border-light mx-1" />

      <ToolbarButton icon={<Search className="h-4 w-4" />}             label="Search" />
      <ToolbarButton icon={<User className="h-4 w-4" />}               label="Person" />
      <ToolbarButton icon={<SlidersHorizontal className="h-4 w-4" />}  label="Filter" />
      <ToolbarButton icon={<ArrowUpDown className="h-4 w-4" />}        label="Sort" />
      <ToolbarButton icon={<EyeOff className="h-4 w-4" />}             label="Hide" />
      <ToolbarButton icon={<Layers className="h-4 w-4" />}             label="Group by" />

      <div className="ml-auto" />
      <ToolbarButton icon={<Plus className="h-4 w-4" />} label="Add column" />
    </div>
  );
}

function ToolbarButton({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 h-9 px-2.5 rounded-base text-sm text-text-secondary hover:bg-hover hover:text-text-primary transition-colors duration-100 disabled:opacity-40 disabled:cursor-not-allowed"
      disabled
      title="Available in Phase 3"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
