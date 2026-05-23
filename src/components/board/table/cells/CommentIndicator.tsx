/**
 * Synthetic comment-indicator cell — brief section L.
 *
 *   • 16×16 speech-bubble icon, centered in the cell.
 *   • 0 comments  → outline icon at 40% opacity; row hover lifts the
 *                   opacity and shows a "+" affordance.
 *   • ≥1 comment  → filled icon at 100% opacity, with a small COUNT
 *                   badge tucked into the bottom-right corner of the
 *                   icon. Badge background = bg-card so it punches
 *                   through the canvas as a tiny enclosed pill.
 *   • Unread > 0  → 6px chip-pink dot at the top-right corner of the
 *                   icon. Sits independent of the count badge.
 *
 * Click anywhere in the cell opens the task panel (where comments live).
 *
 * The unread / total counters read item.updates_count / unread_count
 * loosely so the indicator degrades gracefully if those fields aren't
 * surfaced by the row.
 */
import { MessageCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ItemRow } from '@/lib/database.types';

interface CommentIndicatorProps {
  item: ItemRow;
  onOpen: () => void;
}

function readCounts(item: ItemRow): { total: number; unread: boolean } {
  const loose = item as unknown as { updates_count?: number; unread_count?: number };
  const total  = typeof loose.updates_count === 'number' ? loose.updates_count : 0;
  const unread = typeof loose.unread_count   === 'number' && loose.unread_count > 0;
  return { total, unread };
}

export function CommentIndicator({ item, onOpen }: CommentIndicatorProps) {
  const { total, unread } = readCounts(item);
  const hasComments = total > 0;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={hasComments ? `${total} comment${total === 1 ? '' : 's'}` : 'Add a comment'}
      title={hasComments ? `${total} comment${total === 1 ? '' : 's'}` : 'Open task to add a comment'}
      className={cn(
        'relative h-6 w-6 inline-flex items-center justify-center rounded-sm transition-opacity duration-100',
        hasComments
          ? 'text-text-primary opacity-100'
          : 'text-text-secondary opacity-40 group-hover/row:opacity-100',
      )}
    >
      {/* Speech bubble — 16x16 (h-4 w-4) outline. Filled visual is
          conveyed by the count badge sitting on top of it, not by a
          different icon glyph, so the chip family stays minimal. */}
      <MessageCircle
        className="h-4 w-4"
        fill={hasComments ? 'currentColor' : 'none'}
        strokeWidth={1.75}
      />
      {/* On-hover "+" affordance — only when there are no comments. */}
      {!hasComments && (
        <span
          aria-hidden="true"
          className="absolute inset-0 inline-flex items-center justify-center text-[12px] leading-none opacity-0 group-hover/row:opacity-60 transition-opacity duration-100"
        >
          +
        </span>
      )}
      {/* Bottom-right count badge (icon-corner badge per section L). */}
      {hasComments && total > 1 && (
        <span
          className="absolute -bottom-1 -right-1 inline-flex items-center justify-center min-w-[14px] h-[14px] px-[3px] rounded-pill text-[10px] font-semibold leading-none"
          style={{
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
            boxShadow: '0 0 0 1.5px var(--bg-canvas)',
          }}
        >
          {total > 99 ? '99+' : total}
        </span>
      )}
      {/* Top-right unread dot — 6px chip-pink, sits independent of the
          count so a single-unread row still shows it. */}
      {unread && (
        <span
          aria-label="Unread"
          className="absolute top-0 right-0 h-1.5 w-1.5 rounded-pill"
          style={{
            background: 'var(--chip-pink)',
            boxShadow: '0 0 0 1.5px var(--bg-canvas)',
          }}
        />
      )}
    </button>
  );
}
