import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { cn } from '@/lib/cn';

export interface MentionItem {
  id: string;
  label: string;        // full_name or username (display)
  username: string;
  avatar_url: string | null;
}

interface MentionListProps {
  items: MentionItem[];
  command: (item: { id: string; label: string }) => void;
}

export interface MentionListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export const MentionList = forwardRef<MentionListHandle, MentionListProps>(({ items, command }, ref) => {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { setIndex((i) => (i + 1) % Math.max(items.length, 1)); return true; }
      if (e.key === 'ArrowUp')   { setIndex((i) => (i - 1 + items.length) % Math.max(items.length, 1)); return true; }
      if (e.key === 'Enter') {
        const it = items[index];
        if (it) { command({ id: it.id, label: it.label }); return true; }
      }
      return false;
    },
  }), [items, index, command]);

  if (items.length === 0) {
    return (
      <div className="bg-surface border border-border-light rounded-md shadow-lg px-3 py-2 text-xs text-text-disabled w-[220px]">
        No matches
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border-light rounded-md shadow-lg w-[240px] max-h-[240px] overflow-y-auto py-1">
      {items.map((it, i) => (
        <button
          key={it.id}
          type="button"
          onClick={() => command({ id: it.id, label: it.label })}
          className={cn(
            'w-full text-left px-2 py-1.5 inline-flex items-center gap-2 text-sm',
            i === index ? 'bg-selected text-brand' : 'hover:bg-hover',
          )}
        >
          <Avatar name={it.label} url={it.avatar_url} size="sm" />
          <span className="flex-1 min-w-0">
            <span className="block truncate">{it.label}</span>
            <span className="block text-[11px] text-text-secondary truncate">@{it.username}</span>
          </span>
        </button>
      ))}
    </div>
  );
});

MentionList.displayName = 'MentionList';
