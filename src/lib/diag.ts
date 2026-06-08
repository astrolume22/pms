/**
 * Diagnostic flags for the post-refocus "spinner stuck, must refresh"
 * investigation.
 *
 * Two flags, one file:
 *
 *   DIAG (default true)
 *     Master switch for every instrumented console.log added during
 *     the 10-way refocus-wedge hunt. Flip to false to silence the
 *     entire DIAG channel across boardSync, AppShell, shift hooks,
 *     etc. without touching any behaviour. The fetch-layer logs in
 *     src/lib/supabase.ts and the getSession logs in safeAuth.ts have
 *     their own flags (DIAG_FETCH there, DIAG in safeAuth) — we don't
 *     reach across module boundaries to override them, but they're
 *     all already true today.
 *
 *   DISABLE_REALTIME (default false)
 *     Founder's isolation test. When true, useBoardRealtimeSync's
 *     useEffect short-circuits before opening a Supabase Realtime
 *     channel. NOTHING ELSE CHANGES: the 3-second board_watermark
 *     poll continues running, the same-browser BroadcastChannel still
 *     fires, the Save button still inserts a board_sync_pings row.
 *     What disappears: the WebSocket connection to
 *     `wss://<project>.supabase.co/realtime/v1/...`, the
 *     postgres_changes events, and the Realtime broadcast.
 *
 *     Compare WITH and WITHOUT realtime:
 *       1. DISABLE_REALTIME = false  (current)  → bug present? → yes/no
 *       2. DISABLE_REALTIME = true   → reload → bug present? → yes/no
 *
 *     If row 1 = yes AND row 2 = no, the WebSocket IS the culprit.
 *     If both rows = yes, realtime is innocent and the bug lives in
 *     the fetch/query path (candidates 4-10).
 *
 *     This is a diagnostic toggle ONLY — not a permanent off-switch.
 *     Flip back to false once we know.
 */
export const DIAG = true;
export const DISABLE_REALTIME = false;

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
