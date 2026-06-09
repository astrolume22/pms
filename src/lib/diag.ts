/**
 * Diagnostic + behaviour flags for the post-refocus "spinner stuck,
 * must refresh" fix.
 *
 *   DIAG (default true)
 *     Master switch for instrumented console.logs added during the
 *     10-way refocus-wedge hunt. Flip to false to silence the entire
 *     DIAG channel across boardSync, AppShell, shift hooks, etc.
 *     without touching any behaviour.
 *
 *   DISABLE_REALTIME (default TRUE — see decision below)
 *     The Realtime WebSocket is OFF by default. The founder's live
 *     console proved that after a sub-1s blur→focus, 3 board/shift
 *     queries get stuck in fetchStatus='pending' forever and the
 *     spinner never clears. With realtime disabled, the app runs on
 *     plain HTTPS fetch + the 3-second board_watermark poll + the
 *     BroadcastChannel for same-browser sync. Cross-machine updates
 *     (Dr. John's edits) still arrive — they're carried by the
 *     watermark poll, just at 3s latency instead of WebSocket
 *     instant. We chose reliability over instant.
 *
 *     Reverting to true (i.e. re-enabling realtime) is a single
 *     character edit and rebuilds in seconds — kept as a flag, not
 *     deleted, so the option stays available if a future fix
 *     genuinely heals the WebSocket-after-blur teardown.
 */
export const DIAG = true;
export const DISABLE_REALTIME = true;

/**
 * Common diag log entry point. Always prefixes with `[diag][<tag>]`
 * so the founder can grep DevTools console for `[diag]` and see every
 * instrumented event across the whole app in one stream.
 */
export function diag(tag: string, ...args: unknown[]): void {
  if (!DIAG) return;
  console.log(`[diag][${tag}]`, ...args);
}

/**
 * Walk every query in the cache and report anything that looks stuck.
 * Called on focus and on every "things look wrong" hook. Pure read.
 *
 * Reports:
 *   • fetchStatus === 'paused'   — should be impossible with
 *                                   networkMode:'always', so seeing
 *                                   ANY paused queries here is a
 *                                   smoking gun for candidate #4.
 *   • status === 'pending'       — a fetch is supposedly in flight
 *                                   but nothing has resolved. Pair
 *                                   with the fetch # log in
 *                                   supabase.ts to check whether a
 *                                   network request actually went out.
 *   • status === 'error'         — query is in error state. If it's
 *                                   one of the board/shift keys, the
 *                                   user is staring at a stale UI.
 */
import type { QueryClient } from '@tanstack/react-query';

/**
 * One-time helper exposed only when DIAG is on. Lets the founder run
 * `window.__dumpQueries()` from DevTools console post-refocus and see
 * which React Query keys are 'idle'+stale (never refetch — trigger
 * problem) vs 'fetching' (fired but hung — network/fetch problem).
 * Pure read; no behavior change.
 */
export function installDumpQueriesHelper(qc: QueryClient): void {
  if (!DIAG) return;
  if (typeof window === 'undefined') return;
  (window as unknown as { __dumpQueries?: () => unknown[] }).__dumpQueries = () => {
    const all = qc.getQueryCache().getAll();
    return all.map((q) => ({
      key:            q.queryKey,
      status:         q.state.status,
      fetchStatus:    q.state.fetchStatus,
      isStale:        q.isStale(),
      dataUpdatedAt:  q.state.dataUpdatedAt,
      errorUpdatedAt: q.state.errorUpdatedAt,
      observers:      q.getObserversCount(),
    }));
  };
}

export function logStuckQueries(qc: QueryClient, where: string): void {
  if (!DIAG) return;
  const all = qc.getQueryCache().getAll();
  const paused: (readonly unknown[])[] = [];
  const pending: (readonly unknown[])[] = [];
  const errored: (readonly unknown[])[] = [];
  for (const q of all) {
    const fs = q.state.fetchStatus;
    const s  = q.state.status;
    if (fs === 'paused')  paused.push(q.queryKey);
    if (s === 'pending')  pending.push(q.queryKey);
    if (s === 'error')    errored.push(q.queryKey);
  }
  diag('cache', `${where}: ${all.length} queries — paused=${paused.length} pending=${pending.length} errored=${errored.length}`);
  for (const k of paused)  diag('cache.paused',  k);
  for (const k of pending) diag('cache.pending', k);
  for (const k of errored) diag('cache.errored', k);
}
