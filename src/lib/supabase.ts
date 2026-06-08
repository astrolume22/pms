import { createClient } from '@supabase/supabase-js';
import { toast } from 'sonner';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing Supabase env. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local',
  );
}

// =====================================================================
// Auth lock — USE AUTH-JS'S DEFAULT navigator.locks.
//
// HISTORY:
//   • P1.5 era we shipped `passThroughLock` (a no-op shim) to dodge an
//     older deadlock with a custom in-memory lock. That shim has since
//     turned out to be a worse cure than the disease.
//
//   • In auth-js 2.106+ the constructor (GoTrueClient.ts:381-387) picks
//     `navigatorLock` (Web Locks API) automatically when no `lock`
//     option is passed AND `persistSession` is true AND the browser has
//     `globalThis.navigator.locks`. Every modern browser does. That's a
//     real, kernel-backed mutex.
//
//   • passThroughLock made every concurrent _acquireLock() race the
//     `lockAcquired` flag (GoTrueClient.ts:301-302) and the
//     `pendingInLock` chain (GoTrueClient.ts:2680-2698). On every
//     window blur/focus, BOTH auth-js's native visibility handler AND
//     our own focus listener called `_acquireLock` concurrently. With
//     passThroughLock those calls ran in parallel, corrupted
//     `lockAcquired`, and could chain new `getSession()` calls onto an
//     orphaned promise that never resolved. The next supabase.from(...)
//     anywhere in the app hung at its internal `getSession()`. The
//     symptom: a sub-second alt-tab wedged the whole UI and only a
//     manual reload recovered (because reload built a fresh GoTrue
//     instance with empty queues).
//
// FIX: omit `lock` — auth-js picks navigatorLock by itself, the real
// mutex serializes the concurrent visibility/focus calls into a clean
// sequence, and the wedge can't happen.
// =====================================================================

// =====================================================================
// Hard-timeout + refresh-on-401 fetch wrapper. ALL Supabase HTTP routes
// through this: PostgREST, Storage, the auth-token endpoint itself.
//
// (1) Timeout split per plane:
//
//       DATAPLANE_TIMEOUT_MS = 6_000  (PostgREST + Storage)
//         Earlier we tried 3s. Too aggressive — heavy queries on big
//         boards (Tessera) regularly took 2-4s and got aborted, which
//         (combined with retry:1) left queries permanently stuck in
//         error state because every board hook has
//         refetchOnWindowFocus:false. 6s is enough headroom for the
//         heaviest reads while still bounding parked-socket hangs.
//
//       AUTHPLANE_TIMEOUT_MS = 12_000  (/auth/v1/token? — refresh)
//         The token refresh on a cold socket can be slow (TCP setup +
//         TLS handshake). Giving refresh a wider budget lets recovery
//         actually complete instead of timing out half-way.
//
// (2) Refresh-on-401 + retry (P4.0): if PostgREST or Storage returns
//     401, refresh the session, rewrite the Authorization header, and
//     retry the request ONCE. Only data-plane URLs are eligible — the
//     /auth/v1/ endpoint must never recursively retry on itself.
// =====================================================================
const DATAPLANE_TIMEOUT_MS = 6_000;
const AUTHPLANE_TIMEOUT_MS = 12_000;

// Temporary diagnostic flag. Mirrors the DIAG flag in safeAuth.ts.
// While hunting the post-refocus "spinner with no request" recurrence,
// log every fetch entry/exit so the founder can see in DevTools whether
// requests are actually being attempted. Flip to false later.
const DIAG_FETCH = true;

// Short label for the URL so the console isn't flooded with long
// PostgREST query strings.
function shortLabel(target: string): string {
  const rest = target.split('/rest/v1/')[1];
  if (rest) return '/rest/v1/' + rest.split('?')[0];
  const auth = target.split('/auth/v1/')[1];
  if (auth) return '/auth/v1/' + auth.split('?')[0];
  const storage = target.split('/storage/v1/')[1];
  if (storage) return '/storage/v1/' + storage.split('?')[0];
  return target;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function isAuthPlaneUrl(target: string): boolean {
  return target.includes('/auth/v1/');
}

let fetchCounter = 0;

function timeoutFetchOnce(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs: number = DATAPLANE_TIMEOUT_MS,
): Promise<Response> {
  // CRITICAL: a fresh AbortController per call. The old controller from
  // a previous attempt would already be aborted (we trigger abort() in
  // the timer below to enforce timeoutMs). Reusing it would cause this
  // fetch to start in an already-aborted state and reject immediately,
  // which (under React Query's retry rules) can look like "the network
  // layer silently dropped my request." We always allocate a new one.
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
  const id = DIAG_FETCH ? ++fetchCounter : 0;
  const target = urlOf(input);
  const label = shortLabel(target);
  if (DIAG_FETCH) console.log(`[fetch #${id}] -> ${label}`);
  const start = DIAG_FETCH ? Date.now() : 0;
  const timer = setTimeout(() => {
    try {
      ctrl.abort(new DOMException(`Request timed out after ${timeoutMs / 1000}s`, 'TimeoutError'));
    } catch {
      ctrl.abort();
    }
  }, timeoutMs);
  return fetch(input, { ...init, signal: ctrl.signal })
    .then((resp) => {
      if (DIAG_FETCH) console.log(`[fetch #${id}] <- ${label} status=${resp.status} in ${Date.now() - start}ms`);
      return resp;
    })
    .catch((err: unknown) => {
      if (DIAG_FETCH) {
        const name = err instanceof Error ? err.name : 'unknown';
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[fetch #${id}] xx ${label} ${name}: ${msg} in ${Date.now() - start}ms`);
      }
      throw err;
    })
    .finally(() => clearTimeout(timer));
}

async function timeoutFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const target = urlOf(input);
  const isAuth = isAuthPlaneUrl(target);
  const isDataPlane = target.includes('/rest/v1/') || target.includes('/storage/v1/');
  const budget = isAuth ? AUTHPLANE_TIMEOUT_MS : DATAPLANE_TIMEOUT_MS;

  let resp = await timeoutFetchOnce(input, init, budget);

  if (resp.status === 401 && isDataPlane) {
    try {
      console.log('[fetch-auth-retry] 401 on', target.split('/rest/v1/')[1]?.split('?')[0] ?? target, '— refreshing token');
      notifyReconnecting();
      const { data, error } = await supabase.auth.refreshSession();
      if (!error && data.session?.access_token) {
        const retryHeaders = new Headers(init?.headers ?? undefined);
        retryHeaders.set('Authorization', `Bearer ${data.session.access_token}`);
        const retryInit: RequestInit = { ...init, headers: retryHeaders };
        const retry = await timeoutFetchOnce(input, retryInit, DATAPLANE_TIMEOUT_MS);
        console.log('[fetch-auth-retry] retry status', retry.status);
        if (retry.ok) notifyReconnected();
        // Bug closed: previously, a non-ok retry left `reconnectActive`
        // stuck true forever — every subsequent recovery toast was
        // suppressed. Now we explicitly mark the recovery as failed so
        // the flag releases.
        else notifyReconnectFailed();
        return retry;
      }
      console.log('[fetch-auth-retry] refresh failed, returning original 401');
      notifyReconnectFailed();
    } catch (e) {
      console.log('[fetch-auth-retry] refresh threw, returning original 401', (e as Error)?.message);
      notifyReconnectFailed();
    }
  }

  return resp;
}

// =====================================================================
// Recovery visibility — debounced sonner toasts.
//
// Whenever a REAL recovery actually runs (timeoutFetch's 401-retry
// path), we show "Reconnecting…" while it's in flight, then either
// "Reconnected." on success or "Reconnect failed" on failure. The
// reconnectActive flag is now WATCHDOGGED: any time we set it true we
// also schedule a 15s auto-release so the flag can never stick true
// permanently even if a control-flow path forgets to clear it.
// =====================================================================
const RECONNECT_TOAST_ID = 'pms-reconnecting';
const RECONNECT_TOAST_THROTTLE_MS = 5_000;
const RECONNECT_WATCHDOG_MS = 15_000;
let lastReconnectShownAt = 0;
let reconnectActive = false;
let reconnectWatchdog: ReturnType<typeof setTimeout> | null = null;

function clearReconnectWatchdog(): void {
  if (reconnectWatchdog !== null) {
    clearTimeout(reconnectWatchdog);
    reconnectWatchdog = null;
  }
}

function notifyReconnecting(): void {
  const now = Date.now();
  if (reconnectActive) return; // already showing the spinner
  if (now - lastReconnectShownAt < RECONNECT_TOAST_THROTTLE_MS) return;
  lastReconnectShownAt = now;
  reconnectActive = true;
  // Belt-and-suspenders watchdog: if for any reason neither
  // notifyReconnected nor notifyReconnectFailed runs (e.g. an unhandled
  // throw in some new caller), release the flag after 15s so future
  // recovery toasts aren't permanently suppressed.
  clearReconnectWatchdog();
  reconnectWatchdog = setTimeout(() => {
    if (reconnectActive) {
      console.warn('[reconnect] watchdog fired — releasing stuck flag');
      reconnectActive = false;
    }
    reconnectWatchdog = null;
  }, RECONNECT_WATCHDOG_MS);
  try {
    toast.loading('Reconnecting…', { id: RECONNECT_TOAST_ID, duration: RECONNECT_WATCHDOG_MS });
  } catch {
    /* sonner not mounted on cold boot */
  }
}
function notifyReconnected(): void {
  if (!reconnectActive) return;
  reconnectActive = false;
  clearReconnectWatchdog();
  try {
    toast.success('Reconnected', { id: RECONNECT_TOAST_ID, duration: 2_000 });
  } catch {
    /* ignore */
  }
}
function notifyReconnectFailed(): void {
  if (!reconnectActive) return;
  reconnectActive = false;
  clearReconnectWatchdog();
  try {
    toast.error('Reconnect failed — try again or refresh', {
      id: RECONNECT_TOAST_ID,
      duration: 4_000,
    });
  } catch {
    /* ignore */
  }
}

// =====================================================================
// Per-tab in-memory auth mutex with a hard 2s ceiling. Replaces
// auth-js's origin-scoped navigatorLock (Web Locks API), which was
// shared across every tab of this origin and could deadlock getSession()
// on refocus — blocking every supabase call BEFORE any fetch was issued.
//
// Mechanism of the bug we're fixing:
//   1. Two tabs of p-m-system.vercel.app are open. Web Locks is origin-
//      scoped per W3C spec, so `lock:pms.auth` is one lock shared by both.
//   2. On refocus, auth-js's own visibilitychange handler
//      (GoTrueClient _handleVisibilityChange) acquires that lock to run
//      _recoverAndRefresh.
//   3. Every supabase.from()/.rpc()/mutation awaits getSession() →
//      _acquireLock BEFORE the fetch line ever runs (supabase-js cjs:
//      _getAccessToken → auth.getSession → _acquireLock). If the lock is
//      held by a frozen sibling tab or the in-process pendingInLock
//      queue-drain never settles, every call queues forever and no HTTP
//      request is ever issued — React Query stuck pending with ZERO
//      network traffic, matching the observed symptom exactly.
//
// What this lock does:
//   • Lives inside THIS tab's JS heap (a single promise chain). No
//     navigator.locks.request call → no origin-wide shared lock → no
//     cross-tab contention possible.
//   • Caps every single fn() invocation at 2s with Promise.race against a
//     setTimeout that rejects with an AbortError. Auth-js catches the
//     rejection and proceeds (or surfaces a clean error) — it cannot wedge.
//   • Serializes calls so auth-js's internal invariants (one in-flight
//     getSession at a time, refresh-then-read ordering) still hold.
//   • A rejection in fn() does NOT poison the chain — the next caller's
//     run() fires either way. The chain stores `void` only.
// =====================================================================
let authLockChain: Promise<unknown> = Promise.resolve();
const AUTH_LOCK_TIMEOUT_MS = 2_000;
function tabLocalAuthLock<R>(_name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> {
  const run = async (): Promise<R> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        fn(),
        new Promise<R>((_, reject) => {
          timer = setTimeout(
            () => reject(new DOMException('auth lock timed out after 2s', 'AbortError')),
            AUTH_LOCK_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  // Serialize on a chain, but never let a rejection poison the chain.
  const next = authLockChain.then(run, run);
  authLockChain = next.then(() => undefined, () => undefined);
  return next as Promise<R>;
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    // autoRefreshToken is intentionally OFF.
    //
    // When true, auth-js installs its own visibilitychange listener
    // (GoTrueClient.ts:5062) that calls _recoverAndRefresh on every tab
    // refocus — which acquires the auth lock BEFORE issuing any HTTP
    // request. That handler is the confirmed trigger of the refocus
    // wedge: a sub-second blur→focus is enough for the lock to be held
    // briefly while every subsequent supabase.from()/.rpc() is queued
    // behind it, and any stall in _recoverAndRefresh (cold socket,
    // throttled timer, frozen sibling tab) leaves the whole UI hanging
    // with zero network traffic.
    //
    // With autoRefreshToken:false, auth-js installs NO visibility/focus
    // handler at all. Token rotation happens lazily via timeoutFetch's
    // refresh-on-401 retry below: when a request comes back 401 because
    // the access token expired, we call supabase.auth.refreshSession()
    // ONCE, rewrite the Authorization header, and retry. That covers
    // the only thing the background auto-refresher was buying us.
    autoRefreshToken: false,
    // Auto-parse magic-link + recovery callbacks from the URL hash so
    // /reset-password and magic-link → / flows pick up the session.
    detectSessionInUrl: true,
    storageKey: 'pms.auth',
    // Explicit per-tab lock replaces auth-js's default navigatorLock
    // (Web Locks API). navigatorLock is ORIGIN-scoped: two tabs of this
    // app share one `lock:pms.auth`, and a stall in tab A's
    // _recoverAndRefresh callback wedges tab B's next supabase call
    // forever — getSession awaits _acquireLock BEFORE issuing any
    // fetch. The replacement is in-memory (per-tab, no cross-tab scope)
    // and bounded to 2s so no acquire can hang indefinitely.
    lock: tabLocalAuthLock,
    lockAcquireTimeout: AUTH_LOCK_TIMEOUT_MS,
  },
  global: {
    fetch: timeoutFetch,
  },
});

// =====================================================================
// NOTE: previously this module installed its own
// `visibilitychange` + `window.focus` listeners that called a
// `refreshAndProbe` function. That function did:
//   1. supabase.auth.getSession()
//   2. supabase.auth.refreshSession() if token expiring
//   3. a raw GET probe to /rest/v1/board_sync_pings
//
// All three operations entered auth-js's `_acquireLock`. Combined with
// the old `passThroughLock` shim, two concurrent visibility callbacks
// (ours + auth-js's native one) corrupted `lockAcquired` and could
// orphan an entry in `pendingInLock`. Every subsequent supabase query
// chained onto that orphaned promise and hung. The founder's "blur
// for ~1ms then must refresh" symptom was exactly this wedge.
//
// The fix is structural:
//   • passThroughLock is removed (auth-js uses navigatorLock natively).
//   • Our duplicate visibility/focus listeners are removed entirely —
//     auth-js's native `_handleVisibilityChange` already calls
//     `_recoverAndRefresh` on every focus event when autoRefreshToken
//     is true. We had two paths racing for the same lock; now there is
//     ONE path.
//   • The board-side "refetch on refocus" logic lives in
//     AppShell.useRefocusInvalidate (gated on a real >=5s hidden
//     duration so sub-second blurs are no-ops).
//
// Result: a brief blur→focus does nothing in this file. The 401-retry
// path above still self-heals any single stale-token request the next
// time the user actually clicks something.
// =====================================================================
