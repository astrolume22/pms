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

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function isAuthPlaneUrl(target: string): boolean {
  return target.includes('/auth/v1/');
}

function timeoutFetchOnce(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs: number = DATAPLANE_TIMEOUT_MS,
): Promise<Response> {
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
      ctrl.abort(new DOMException(`Request timed out after ${timeoutMs / 1000}s`, 'TimeoutError'));
    } catch {
      ctrl.abort();
    }
  }, timeoutMs);
  return fetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
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

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    // autoRefreshToken: true means auth-js installs its own
    // visibilitychange listener (GoTrueClient.ts:5062) that runs
    // _recoverAndRefresh on tab focus. That handler is the SOURCE OF
    // TRUTH for refresh-on-focus — we no longer install our own
    // duplicate handler.
    autoRefreshToken: true,
    // Auto-parse magic-link + recovery callbacks from the URL hash so
    // /reset-password and magic-link → / flows pick up the session.
    detectSessionInUrl: true,
    storageKey: 'pms.auth',
    // No `lock:` option — auth-js auto-selects navigatorLock (real Web
    // Locks API mutex). See the "Auth lock" comment block above for
    // why the previous passThroughLock shim was the root cause of the
    // focus-then-wedge bug.
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
