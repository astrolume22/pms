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
import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

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

// =====================================================================
// useBoardRealtimeSync — Supabase Realtime subscription for CROSS-MACHINE
// live sync. Mount once at the board route when boardId is known.
//
// Why this exists on top of the BroadcastChannel above:
//   • BroadcastChannel only crosses tabs on the SAME browser + machine.
//   • The founder's actual use case (CLAUDE.md) is two computers — the
//     owner and Dr. John — both editing Tessera. BroadcastChannel
//     cannot reach across machines; only Realtime can.
//   • Migration 0049 added the 4 board tables to the supabase_realtime
//     publication, so postgres_changes events now actually fire.
//
// What it does:
//   • Opens ONE channel per board ('board:<boardId>').
//   • Subscribes to INSERT/UPDATE/DELETE on items + item_column_values
//     + groups + columns, filtered by board_id where possible. For
//     item_column_values the table has no board_id column, so we
//     subscribe to all rows and let the React Query refetch naturally
//     pull in only the changes that matter to the open board (cheap —
//     a single board has < a few hundred rows). Bandwidth is tiny.
//   • On EVERY event, invalidates the three board-scoped query keys
//     so React Query refetches. That's intentionally coarse — the
//     refetches are cheap, the logic stays simple, and there's zero
//     chance of partial-state drift between Realtime payloads and
//     the live DB.
//   • Tears the channel down on unmount.
//
// Tenancy: Realtime respects RLS via the user's own JWT. Users only
// receive events for rows their SELECT policy already lets them read.
// No new data exposure.
// =====================================================================
// Module-level registry of live Realtime channels keyed by boardId.
// useBoardRealtimeSync writes here on mount and clears on unmount;
// forceBoardSync() reads from here to send the cross-machine broadcast
// without opening a second channel.
const _boardChannels = new Map<string, RealtimeChannel>();

export function useBoardRealtimeSync(boardId: string | undefined): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!boardId) return;

    const channelName = 'board:' + boardId;
    const ch = supabase.channel(channelName);

    const invalidate = () => {
      void qc.invalidateQueries({ queryKey: ['items', 'board', boardId] });
      void qc.invalidateQueries({ queryKey: ['groups', 'board', boardId] });
      void qc.invalidateQueries({ queryKey: ['columns', 'board', boardId] });
    };

    // Rows that carry board_id directly — filter server-side so we
    // only receive what's relevant. (Saves bandwidth + protects
    // against accidental cross-board leakage even if RLS were misconfigured.)
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'items',
      filter: 'board_id=eq.' + boardId }, invalidate);
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'groups',
      filter: 'board_id=eq.' + boardId }, invalidate);
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'columns',
      filter: 'board_id=eq.' + boardId }, invalidate);

    // item_column_values has no board_id column — subscribe globally
    // and invalidate on any change. Since the React Query queries are
    // already scoped to this board, the refetch only pulls our rows.
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'item_column_values' }, invalidate);

    // board_sync_pings — the "Save" button writes a row here on click.
    // This is the most reliable cross-machine signal: it goes through
    // the postgres_changes pipeline (which is what cell saves use), so
    // if cell saves propagate at all, this will too. Even if the
    // dedicated broadcast layer below silently fails, this row write
    // delivers via the same well-tested path. Filtered by board_id so
    // we only wake up for our own board.
    ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'board_sync_pings',
      filter: 'board_id=eq.' + boardId }, invalidate);

    // Broadcast layer — same-name channel ('board:<boardId>'). Fastest
    // signal IF the Realtime broadcast service is healthy on the
    // project. We keep it as a supplementary layer; the postgres_changes
    // path above is the actual reliability guarantee.
    ch.on('broadcast', { event: 'force-sync' }, () => {
      invalidate();
    });

    ch.subscribe();
    _boardChannels.set(boardId, ch);

    return () => {
      _boardChannels.delete(boardId);
      void supabase.removeChannel(ch);
    };
  }, [boardId, qc]);
}

// =====================================================================
// useBoardWatermarkPoll — cheap 3-second cross-device sync backstop.
//
// Why this exists:
//   The user wants any change made anywhere to land in every open tab
//   within 1-5 seconds — even when Supabase Realtime is broken/paused
//   at the project level. Realtime + the Save button still give
//   instant when they work; this is the guaranteed always-works layer.
//
// What it does:
//   • Polls the board_watermark(boardId) RPC every 3 seconds. The RPC
//     returns ONE timestamp — the max of items.updated_at,
//     groups.updated_at, columns.updated_at,
//     item_column_values.updated_at, and board_sync_pings.pinged_at
//     across this board. Total payload: ~30 bytes per poll.
//   • Compares it to the last seen value (held in a ref so it
//     survives re-renders without re-firing the effect).
//   • When the watermark advances → invalidates the three heavy
//     board queries → React Query refetches → UI updates.
//
// Cost:
//   • 30 bytes × 20 polls/min = 600 bytes/min per tab. Negligible.
//   • The full board refetch only happens when something ACTUALLY
//     changed, not every 3 seconds.
//
// Mount at the board route. Tears down on unmount.
// =====================================================================
export function useBoardWatermarkPoll(boardId: string | undefined): void {
  const qc = useQueryClient();
  const lastSeenRef = useRef<string | null>(null);

  useQuery({
    queryKey: ['board-watermark', boardId],
    enabled: !!boardId,
    // Tight loop — the polling RPC is tiny. 3 seconds gives a worst-
    // case sync latency well under the user's "max 5 seconds" target.
    refetchInterval: 3_000,
    // Also refire the moment the user clicks back into this tab.
    refetchOnWindowFocus: true,
    // Don't keep retrying noisily on transient errors.
    retry: 1,
    queryFn: async () => {
      if (!boardId) return null;
      const { data, error } = await supabase.rpc('board_watermark', { p_board_id: boardId });
      if (error) throw error;
      const ts = typeof data === 'string' ? data : null;
      if (!ts) return null;
      const previous = lastSeenRef.current;
      lastSeenRef.current = ts;
      // First call: record the baseline, don't invalidate (would just
      // cause a redundant refetch right after mount).
      if (previous === null) return ts;
      if (ts !== previous) {
        void qc.invalidateQueries({ queryKey: ['items', 'board', boardId] });
        void qc.invalidateQueries({ queryKey: ['groups', 'board', boardId] });
        void qc.invalidateQueries({ queryKey: ['columns', 'board', boardId] });
      }
      return ts;
    },
  });

  // Reset baseline when boardId changes so a fresh board starts clean.
  useEffect(() => {
    lastSeenRef.current = null;
  }, [boardId]);
}

// =====================================================================
// forceBoardSync — the "Save" button's handler.
//
// Fans a refresh request out to every layer we have:
//   1. Local: invalidate this tab's React Query board keys so the
//      current tab pulls the latest DB state immediately.
//   2. Same-browser cross-tab: publishBoardChange() over the
//      BroadcastChannel — other tabs in this browser receive it
//      sub-millisecond and re-invalidate.
//   3. Cross-machine: Realtime broadcast on 'board:<boardId>' so any
//      other browser anywhere (Dr. John's laptop, your phone) that
//      has the same board open receives the force-sync event and
//      re-reads from the DB.
//
// Why three layers: each one has different failure modes. The local
// invalidate always works. The BroadcastChannel covers the user's
// most common multi-tab pattern instantly. The Realtime broadcast
// reaches across the internet — it depends on the Realtime service
// being healthy but does NOT depend on postgres_changes publications
// (so it works even if the publication route is misconfigured).
//
// Returns a count of how many tabs/clients we attempted to notify
// (best-effort; we can't know how many actually received it). The
// caller toasts on success.
// =====================================================================
export interface ForceBoardSyncResult {
  /** Whether the cross-machine DB ping was written (postgres_changes path). */
  ping: 'inserted' | 'failed';
  /** Whether the supplementary Realtime broadcast was acknowledged. */
  broadcast: 'sent' | 'no-channel' | 'failed';
}

export async function forceBoardSync(qc: QueryClient, boardId: string): Promise<ForceBoardSyncResult> {
  // 1. Local invalidate — this tab refetches.
  void qc.invalidateQueries({ queryKey: ['items', 'board', boardId] });
  void qc.invalidateQueries({ queryKey: ['groups', 'board', boardId] });
  void qc.invalidateQueries({ queryKey: ['columns', 'board', boardId] });

  // 2. Same-browser BroadcastChannel — sub-ms for other tabs in this browser.
  publishBoardChange(boardId);

  // 3. CROSS-MACHINE PRIMARY PATH — INSERT a row into board_sync_pings.
  //    This goes through PostgREST → DB → Realtime's postgres_changes
  //    pipeline, which is the same pipeline cell saves use. Subscribed
  //    clients on any machine receive the INSERT event and invalidate.
  //    This is the RELIABLE layer: doesn't depend on broadcasts.
  let ping: 'inserted' | 'failed' = 'failed';
  try {
    const { error } = await supabase
      .from('board_sync_pings')
      .insert({ board_id: boardId } as never);
    ping = error ? 'failed' : 'inserted';
    if (error) console.error('[boardSync] ping insert failed:', error);
  } catch (e) {
    console.error('[boardSync] ping insert threw:', e);
  }

  // 4. CROSS-MACHINE SUPPLEMENTARY PATH — Realtime broadcast on the
  //    per-board channel. Faster IF the broadcast layer is healthy.
  //    If it isn't, the ping above still delivers — no user impact.
  const ch = _boardChannels.get(boardId);
  if (!ch) return { ping, broadcast: 'no-channel' };
  try {
    const result = await ch.send({
      type: 'broadcast',
      event: 'force-sync',
      payload: { ts: Date.now() },
    });
    return { ping, broadcast: result === 'ok' ? 'sent' : 'failed' };
  } catch {
    return { ping, broadcast: 'failed' };
  }
}
