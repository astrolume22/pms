import { LayoutGrid, Sparkles, Heart, Mic, Star, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/cn';

interface RailItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  active?: boolean;
}

const ITEMS: RailItem[] = [
  { key: 'workspace',  label: 'Workspace',  icon: <LayoutGrid className="h-5 w-5" />, active: true },
  { key: 'agents',     label: 'Agents',     icon: <Sparkles  className="h-5 w-5" /> },
  { key: 'vibe',       label: 'Vibe',       icon: <Heart     className="h-5 w-5" /> },
  { key: 'notetaker',  label: 'Notetaker',  icon: <Mic       className="h-5 w-5" /> },
  { key: 'favorites',  label: 'Favorites',  icon: <Star      className="h-5 w-5" /> },
  { key: 'more',       label: 'More',       icon: <MoreHorizontal className="h-5 w-5" /> },
];

export function IconRail() {
  return (
    <nav
      aria-label="Primary"
      className="w-12 shrink-0 flex flex-col items-center py-2 gap-1 border-r border-border-light bg-surface"
    >
      {ITEMS.map((it) => (
        <button
          key={it.key}
          type="button"
          title={it.label}
          aria-label={it.label}
          className={cn(
            'h-9 w-9 inline-flex items-center justify-center rounded-base',
            it.active
              ? 'bg-selected text-brand'
              : 'text-text-secondary hover:bg-hover hover:text-text-primary',
            'transition-colors duration-100',
          )}
        >
          {it.icon}
        </button>
      ))}
    </nav>
  );
}
