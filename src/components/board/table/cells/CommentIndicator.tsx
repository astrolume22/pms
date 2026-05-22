/**
 * Synthetic comment-indicator cell.
 *
 *   • Zero comments  → a faint "+" speech-bubble outline at 60% opacity,
 *                      becomes 100% on row hover. Click opens the task
 *                      panel (which is where comments live).
 *   • ≥1 comment     → an oval count badge.
 *   • Unread > 0     → small chip-pink dot on the badge's top-right.
 *
 * Real unread tracking arrives later (chunk in a separate phase); for
 * now we render the indicator from the item.updates_count / item.unread
 * fields if present, defaulting to 0 / false.
 */
import { MessageSquarePlus, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ItemRow } from '@/lib/database.types';

interface CommentIndicatorProps {
  item: ItemRow;
  onOpen: () => void;
}

// item.updates_count / item.unread_count exist on the live row but
// aren't always in the TS type — read them via a loose lookup so the
// component degrades to "0 / no unread" if absent.
function readCounts(item: ItemRow): { total: number; unread: boolean } {
  const loose = item as unknown as { updates_count?: number; unread_count?: number };
  const total  = typeof loose.updates_count === 'number' ? loose.updates_count : 0;
  const unread = typeof loose.unread_count   === 'number' && loose.unread_count > 0;
  return { total, unread };
}

export function CommentIndicator({ item, onOpen }: CommentIndicatorProps) {
  const { total, unread } = readCounts(item);

  if (total === 0) {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label="Add a comment"
        title="Open task to add a comment"
        className={cn(
          'h-6 w-6 inline-flex items-center justify-center rounded-sm',
          'text-text-secondary opacity-60 group-hover/row:opacity-100',
          'hover:bg-white/[0.08] transition-colors duration-100',
        )}
      >
        <MessageSquarePlus className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${total} comment${total === 1 ? '' : 's'}`}
      title={`${total} comment${total === 1 ? '' : 's'}`}
      className={cn(
        'relative inline-flex items-center gap-1 h-6 px-2 rounded-pill',
        'bg-white/[0.08] text-text-primary hover:bg-white/[0.14] transition-colors duration-100',
      )}
    >
      <MessageSquare className="h-3 w-3 text-text-secondary" />
      <span className="text-[11px] font-medium leading-none">{total}</span>
      {unread && (
        // Small chip-pink unread dot — sits on the top-right of the badge.
        <span
          className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-pill"
          style={{ background: 'var(--chip-pink)' }}
          aria-label="Unread"
        />
      )}
    </button>
  );
}
