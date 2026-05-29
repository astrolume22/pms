/**
 * Cross-tab board live-sync — no Supabase Realtime, no new dependencies.
 *
 * The bug this fixes: open the same board in two tabs of the same browser
 * on the same machine, change a cell in tab A, and tab B silently keeps
 * showing the old value until the user reloads. Cause: React Query has
 * `refetchOnWindowFocus: false` + `staleTime: 60_000`, there is no
 * Realtime subscription, and there was no other channel between tabs.
 *
 * The fix: every mutation that touches a board publishes the boardId on
 * a `BroadcastChannel('pms.board-sync')`. Every tab attaches a listener
 * that invalidates the three React Query keys scoped to that board —
 * items.board(id), groups.board(id), columns.board(id) — so the other
 * tab refetches and re-renders within a single network round-trip.
 *
 * Scope (intentional):
 *   • Same machine, same browser, multiple tabs → instant (sub-ms).
 *   • Different machine (your PC ↔ Dr. John's laptop) → NOT covered.
 *     That would need real Supabase Realtime; it's a bigger change
 *     and a separate decision because of the Realtime quota.
 *
 * Why a BroadcastChannel:
 *   • Already used by @supabase/auth-js for the cross-tab auth sync,
 *     so the pattern is proven in this app.
 *   • No new dependency, no extra HTTP round-trip, no DB load.
 *   • Same-origin only, so no XSS/CSRF surface.
 *   • Silently degrades to a no-op in environments without
 *     BroadcastChannel (older Safari, SSR) — saves still work, just
 *     no cross-tab live update there.
 */
import type { QueryClient } from '@tanstack/react-query';

const CHANNEL_NAME = 'pms.board-sync';

interface BoardChangeMessage {
  /** UUID of the board whose state changed. */
  boardId: string;
  /** Monotonic source-tab clock — useful for debug, ignored by the listener. */
  t: number;
}

// Singleton channel. We guard typeof BroadcastChannel so this module
// is safe to import in any environment (SSR, tests, older browsers).
let channel: BroadcastChannel | null = null;
if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
  } catch {
    // Locked down by extension / iframe policy. Cross-tab sync becomes
    // a no-op; the rest of the app continues to work normally.
    channel = null;
  }
}

/**
 * Broadcast a "this board changed" notification to every other tab on
 * the same origin. Call after every successful mutation that touches a
 * specific board (cell save, item create/rename/archive/delete/reorder,
 * group rename/reorder, column create/rename/delete, label edits, etc.).
 *
 * Safe to call in any environment — silently no-ops if BroadcastChannel
 * isn't available. Never throws.
 */
export function publishBoardChange(boardId: string): void {
  if (!channel || !boardId) return;
  try {
    channel.postMessage({ boardId, t: Date.now() } as BoardChangeMessage);
  } catch {
    /* channel closed mid-write — irrelevant, listener will get a later message */
  }
}

/**
 * Attach the cross-tab listener to a QueryClient. Call ONCE at app
 * startup, right after the QueryClient is created. Subsequent boards
 * the user opens will automatically benefit — the listener just
 * invalidates query keys, React Query handles the rest.
 *
 * Returns a teardown function for tests / HMR.
 */
export function attachBoardSyncListener(qc: QueryClient): () => void {
  if (!channel) return () => {};
  const handler = (event: MessageEvent<BoardChangeMessage>) => {
    const boardId = event.data?.boardId;
    if (!boardId) return;
    // Invalidate every board-scoped query for this id. We don't pull
    // itemKeys/groupKeys/columnKeys from the hook modules to avoid an
    // import cycle — the literal key shapes are stable and tested by
    // every existing call site in src/hooks/{items,groups,columns}.ts.
    void qc.invalidateQueries({ queryKey: ['items', 'board', boardId] });
    void qc.invalidateQueries({ queryKey: ['groups', 'board', boardId] });
    void qc.invalidateQueries({ queryKey: ['columns', 'board', boardId] });
  };
  channel.addEventListener('message', handler);
  return () => {
    if (channel) channel.removeEventListener('message', handler);
  };
}
