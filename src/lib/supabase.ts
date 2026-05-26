import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing Supabase env. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local',
  );
}

// =====================================================================
// Auth lock — PASS-THROUGH (intentional)
// ---------------------------------------------------------------------
// This started life as a cross-tab `navigator.locks` reference, then a
// hand-rolled in-memory mutex, then a more-careful in-memory mutex with
// inFlight tracking and force-acquire. Every iteration of the "smart"
// lock eventually wedged after a rapid tab-switch and froze every later
// supabase.from(...) call (PostgREST goes through getSession → lock).
// The user could only recover by reloading the page.
//
// Why pass-through is correct for THIS app:
//   • PMS is a small internal tool (~20 users) where each user only
//     ever has one tab/session open at a time. The cross-tab refresh
//     contention navigator.locks was designed to prevent does not
//     actually arise here.
//   • @supabase/auth-js already deduplicates concurrent refreshes
//     INTERNALLY via `this.refreshingDeferred` — see _callRefreshToken
//     in node_modules/@supabase/auth-js/.../GoTrueClient.js. Two
//     simultaneous refreshSession() calls within the same client end up
//     awaiting the SAME in-flight fetch.
//   • In the unlikely event that two truly-independent contexts (e.g.
//     two browser tabs of the same user) BOTH refresh at the same
//     moment, the Supabase server's refresh-token reuse window (~10s)
//     lets both calls succeed and the second one inherits the rotated
//     token. The worst case is one extra HTTP request, not data loss.
//   • A pass-through cannot deadlock. Liveness is guaranteed.
//
// What still keeps us safe from session-related bugs:
//   1. `global.fetch` below wraps every HTTP request in a 15s
//      AbortController timeout so no individual fetch can ever hang
//      forever (stale-socket protection on idle tabs).
//   2. supabase-js's autoRefreshToken still rotates the access token
//      on its own schedule.
//   3. The TOKEN_REFRESHED listener in src/state/authStore.ts keeps
//      our session state in sync when auth-js rotates the token.
//
// User authorized this trade-off explicitly: "if there's an extra
// security reason, remove it — I don't need it."
// =====================================================================
async function passThroughLock<R>(
  _name: string,
  _acquireTimeoutMs: number,
  fn: () => Promise<R>,
): Promise<R> {
  // Run the work immediately. No queueing, no gates, no chains —
  // nothing that could ever wedge.
  return fn();
}

// =====================================================================
// Hard-timeout fetch wrapper.
// ---------------------------------------------------------------------
// When a tab idles in the background, Chrome aggressively throttles
// timers AND parks the OS-level HTTP/2 socket.  When the user comes
// back, the next request goes out on a half-dead connection.  The
// browser may take MINUTES to notice the socket is broken (it waits
// on OS TCP keepalive), during which fetch() sits there pending and
// never resolves.  No 401, no error, no retry — the UI just spins
// forever.
//
// This wrapper attaches an AbortController to every Supabase fetch
// so any request that doesn't complete in HARD_TIMEOUT_MS rejects
// with a TimeoutError.  The caller's mutation/query then rejects
// cleanly, react-query unwinds the loading state, and the user can
// retry — instead of an infinite spinner.
//
// We respect the caller's `init.signal` so AbortController plumbing
// from react-query / the route still works.  Once the dead socket
// fails a request, Chrome opens a fresh connection for the next call —
// so a single user-visible failure self-heals every subsequent call.
//
// HARD_TIMEOUT_MS was 15s; lowered to 6s so the worst-case dead-socket
// wait after a tab-return drops from "feels frozen" to "noticeable but
// brief". Node-side measurements show normal PostgREST + auth round-
// trips complete in 300-800 ms here, so 6s is still comfortably above
// p99 for any legitimate request.
// =====================================================================
const HARD_TIMEOUT_MS = 6_000;

function timeoutFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const external = init?.signal;
  if (external) {
    if (external.aborted) {
      ctrl.abort((external as AbortSignal & { reason?: unknown }).reason);
    } else {
      external.addEventListener(
        'abort',
        () => ctrl.abort((external as AbortSignal & { reason?: unknown }).reason),
        { once: true },
      );
    }
  }
  const timer = setTimeout(() => {
    try {
      ctrl.abort(new DOMException('Request timed out after 15s', 'TimeoutError'));
    } catch {
      ctrl.abort();
    }
  }, HARD_TIMEOUT_MS);
  return fetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'pms.auth',
    lock: passThroughLock,
  },
  global: {
    // Every PostgREST / Storage call routes through this. Auth-endpoint
    // calls also honour `global.fetch` for the actual HTTP request.
    fetch: timeoutFetch,
  },
});

// =====================================================================
// Tab-return socket warm-up.
// ---------------------------------------------------------------------
// When a backgrounded tab regains visibility, Chrome may have parked
// the HTTP/2 socket to Supabase. The user's first action then queues
// on that dead socket and sits pending until our timeoutFetch aborts
// it — felt as a "hang" on the click immediately after tab-return.
//
// This handler fires a tiny HEAD ping to /rest/v1/ within 200ms of
// visibility=visible with its OWN 2s AbortController. Three cases:
//   (1) Socket alive → HEAD returns quickly (~200-500ms). No-op.
//   (2) Socket parked/dead → HEAD aborts at 2s. Chrome notices the
//       connection is gone and opens a fresh one for the next request.
//       The user's subsequent click goes on the new socket → fast.
//   (3) User clicks BEFORE the ping completes → their request piggybacks
//       on whatever connection Chrome picks. Either way the ping itself
//       can't make things worse — its only effect is "kill dead socket
//       sooner".
//
// We bail out cheaply when the doc is already visible (initial load),
// when there's no localStorage session (unauthenticated user — nothing
// useful to warm), and ignore any error from the ping itself (it's a
// best-effort warm-up, not user-visible).
// =====================================================================
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const VISIBILITY_WARMUP_TIMEOUT_MS = 2_000;
  let warming = false;

  const warmSocket = () => {
    if (warming) return; // already in flight, don't double-fire
    // Skip if not authenticated — anon users have nothing useful to warm.
    try {
      if (!localStorage.getItem('pms.auth')) return;
    } catch {
      // localStorage may be unavailable in some contexts; skip silently.
      return;
    }
    warming = true;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      try { ctrl.abort(new DOMException('warm-up timeout', 'TimeoutError')); }
      catch { ctrl.abort(); }
    }, VISIBILITY_WARMUP_TIMEOUT_MS);
    // Direct window.fetch (not timeoutFetch) so this stays a 2s window
    // and doesn't double-wrap. Hit a non-existent rest path so PostgREST
    // 404s fast — we only care that the socket round-trips at all.
    fetch(`${url}/rest/v1/`, { method: 'HEAD', signal: ctrl.signal, headers: { apikey: anonKey } })
      .catch(() => { /* dead socket; Chrome will reconnect on next req */ })
      .finally(() => { clearTimeout(timer); warming = false; });
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') warmSocket();
  });
  // window.focus also covers the "alt-tab back" case on some platforms.
  window.addEventListener('focus', warmSocket);
}
