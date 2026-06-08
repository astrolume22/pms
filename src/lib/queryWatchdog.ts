/**
 * Stuck-pending query watchdog.
 *
 * The bug this kills: the founder's live console proved that after a
 * brief blur→focus, a handful of board/shift queries fire and then sit
 * in fetchStatus='pending' forever. timeoutFetch's 6s AbortController
 * fires the abort, but in some cases the rejection is being swallowed
 * before React Query can transition the query to 'error'. The query
 * ends up in a stuck-pending zombie state — no fetch in flight, no
 * resolution coming, no automatic retry. The user sees a spinner that
 * never clears and only a manual page refresh recovers.
 *
 * The fix here is structural rather than chasing whatever subtle bug in
 * supabase-js / React Query / the AbortController lifecycle is
 * swallowing the rejection: on a periodic tick, walk the cache and
 * force-cancel + force-refetch any query that has been pending longer
 * than the threshold. Idempotent — once a query resolves cleanly it
 * disappears from the tracking map and the next tick is a no-op.
 *
 * Behaviour:
 *   • Polls every WATCHDOG_INTERVAL_MS (5s).
 *   • A query becomes a candidate when fetchStatus === 'fetching' OR
 *     state.status === 'pending'.
 *   • The first time we observe a candidate, we record `now` in the
 *     tracking map.
 *   • On a subsequent tick, if a candidate has been pending for
 *     STUCK_THRESHOLD_MS (8s) WITHOUT a state transition (no
 *     dataUpdatedAt change, no fetchFailureCount change), we
 *     cancelQueries + refetchQueries. The cancel discards the
 *     half-dead promise so React Query's internal state isn't stuck
 *     waiting on it; the refetch fires a fresh request.
 *   • Queries that resolve cleanly (or transition to 'error') fall out
 *     of the candidate set on the next tick — no work, no logs.
 *
 * Why a Map keyed on the JSON-stringified queryKey: React Query's
 * `query.queryHash` is the canonical identity, but it's an internal
 * field. Stringifying the public queryKey is stable, cheap, and aligns
 * with React Query's own hashing convention.
 */
import type { QueryClient, Query } from '@tanstack/react-query';
import { DIAG, diag } from '@/lib/diag';

const WATCHDOG_INTERVAL_MS = 5_000;
const STUCK_THRESHOLD_MS    = 8_000;

interface Tracked {
  /** Wall-clock ms when we first saw this query stuck. */
  firstSeenAt: number;
  /** Cache snapshot at first-seen — lets us detect a transition we missed. */
  fetchFailureCount: number;
  dataUpdatedAt: number;
}

function isCandidate(q: Query): boolean {
  const fs = q.state.fetchStatus;
  const s  = q.state.status;
  // 'fetching' is the visible "request in flight" state. If status is
  // 'pending' AND fetchStatus is 'idle', the query has never resolved
  // — also a wedge candidate.
  if (fs === 'fetching') return true;
  if (s === 'pending' && fs === 'idle') return true;
  return false;
}

export function startQueryWatchdog(qc: QueryClient): () => void {
  if (typeof window === 'undefined') return () => {};
  const tracked = new Map<string, Tracked>();

  const tick = () => {
    const now = Date.now();
    const seenThisTick = new Set<string>();

    for (const q of qc.getQueryCache().getAll()) {
      if (!isCandidate(q)) continue;
      const key = JSON.stringify(q.queryKey);
      seenThisTick.add(key);

      const prev = tracked.get(key);
      if (!prev) {
        // First time we see this query stuck. Record and move on; only
        // act if it's STILL stuck on a later tick.
        tracked.set(key, {
          firstSeenAt: now,
          fetchFailureCount: q.state.fetchFailureCount,
          dataUpdatedAt: q.state.dataUpdatedAt,
        });
        continue;
      }

      // Did the query make any forward progress since first-seen?
      // (A new failure counted, or new data arrived.) If yes, reset.
      const progressed =
        q.state.fetchFailureCount !== prev.fetchFailureCount ||
        q.state.dataUpdatedAt    !== prev.dataUpdatedAt;
      if (progressed) {
        tracked.set(key, {
          firstSeenAt: now,
          fetchFailureCount: q.state.fetchFailureCount,
          dataUpdatedAt: q.state.dataUpdatedAt,
        });
        continue;
      }

      const stuckMs = now - prev.firstSeenAt;
      if (stuckMs < STUCK_THRESHOLD_MS) continue;

      // STUCK. Force-cancel the orphaned promise, then force-refetch.
      // Order matters: cancel first so React Query's internal pending
      // promise is discarded; otherwise refetchQueries would await it.
      if (DIAG) diag('watchdog', 'force-refetched stuck query ' + key + ' (stuckMs=' + stuckMs + ')');
      void qc.cancelQueries({ queryKey: q.queryKey })
        .then(() => qc.refetchQueries({ queryKey: q.queryKey }))
        .catch((e) => {
          if (DIAG) diag('watchdog', 'recovery threw for ' + key + ': ' + (e instanceof Error ? e.message : String(e)));
        });
      // Drop the tracking entry so the NEXT tick starts a fresh
      // observation window if the new request also hangs.
      tracked.delete(key);
    }

    // Garbage-collect tracked entries for queries that no longer match.
    for (const key of tracked.keys()) {
      if (!seenThisTick.has(key)) tracked.delete(key);
    }
  };

  const handle = window.setInterval(tick, WATCHDOG_INTERVAL_MS);
  if (DIAG) diag('watchdog', 'started — interval=' + WATCHDOG_INTERVAL_MS + 'ms threshold=' + STUCK_THRESHOLD_MS + 'ms');
  return () => {
    clearInterval(handle);
    tracked.clear();
  };
}
