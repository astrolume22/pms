import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing Supabase env. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local',
  );
}

// =====================================================================
// Auth lock — PASS-THROUGH (intentional). See history in P1.5 notes:
// every "smart" lock implementation eventually wedged on tab-switch and
// froze later supabase.from(...) calls. supabase-auth-js already
// deduplicates concurrent refreshes via its own refreshingDeferred, so
// queueing on top of that is pure deadlock risk for this single-tab
// internal tool. Pass-through is liveness-guaranteed.
// =====================================================================
async function passThroughLock<R>(
  _name: string,
  _acquireTimeoutMs: number,
  fn: () => Promise<R>,
): Promise<R> {
  return fn();
}

// =====================================================================
// Hard-timeout + refresh-on-401 fetch wrapper.  ALL Supabase HTTP routes
// through this:  PostgREST, Storage, the auth-token endpoint itself.
//
// (1) Timeout: when a tab idles in the background, Chrome parks the
//     HTTP/2 socket. The next request would otherwise sit pending for
//     MINUTES waiting on OS TCP keepalive. We bound every fetch at
//     HARD_TIMEOUT_MS so the caller's query/mutation rejects cleanly.
//
// (2) Refresh-on-401 + retry (P4.0 fix): if PostgREST or Storage
//     returns 401, we ask supabase-auth-js to refresh the session,
//     rewrite the Authorization header with the new access token, and
//     retry the request ONCE. Without this, the founder's symptom was:
//     backgrounded tab → access token expired silently → first request
//     on refocus 401s → React Query retries the same stale token →
//     401 again → UI sits on a spinner. With this, the 401 path
//     self-heals in one extra round-trip.
//
//     Only PostgREST + Storage URLs are eligible — we skip the
//     /auth/v1/ path so the recursive refresh call doesn't loop on
//     itself. Only ONE retry per call, ever, to bound the worst case.
// =====================================================================
const HARD_TIMEOUT_MS = 6_000;

function timeoutFetchOnce(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
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
      ctrl.abort(new DOMException(`Request timed out after ${HARD_TIMEOUT_MS / 1000}s`, 'TimeoutError'));
    } catch {
      ctrl.abort();
    }
  }, HARD_TIMEOUT_MS);
  return fetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

async function timeoutFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const target = urlOf(input);
  // Only refresh-and-retry for the data-plane endpoints. /auth/v1/ must
  // never be retried this way — it would loop on itself if the refresh
  // itself ever 401'd (shouldn't, but cheap belt-and-suspenders).
  const isDataPlane = target.includes('/rest/v1/') || target.includes('/storage/v1/');

  let resp = await timeoutFetchOnce(input, init);

  if (resp.status === 401 && isDataPlane) {
    try {
      console.log('[fetch-auth-retry] 401 on', target.split('/rest/v1/')[1]?.split('?')[0] ?? target, '— refreshing token');
      const { data, error } = await supabase.auth.refreshSession();
      if (!error && data.session?.access_token) {
        const retryHeaders = new Headers(init?.headers ?? undefined);
        retryHeaders.set('Authorization', `Bearer ${data.session.access_token}`);
        const retryInit: RequestInit = { ...init, headers: retryHeaders };
        const retry = await timeoutFetchOnce(input, retryInit);
        console.log('[fetch-auth-retry] retry status', retry.status);
        return retry;
      }
      console.log('[fetch-auth-retry] refresh failed, returning original 401');
    } catch (e) {
      console.log('[fetch-auth-retry] refresh threw, returning original 401', (e as Error)?.message);
    }
  }

  return resp;
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Auto-parse magic-link + recovery callbacks from the URL hash so
    // /reset-password and magic-link → / flows pick up the session.
    detectSessionInUrl: true,
    storageKey: 'pms.auth',
    lock: passThroughLock,
  },
  global: {
    fetch: timeoutFetch,
  },
});

// =====================================================================
// Tab-return refresh + authenticated probe.   P4.0 root-cause fix.
// ---------------------------------------------------------------------
// PREVIOUS BUG: this handler fired a HEAD /rest/v1/ with ONLY the apikey
// (no Authorization). PostgREST 401'd it. The console showed repeated
// "HEAD /rest/v1/ 401 net::ERR_ABORTED" spam — and because the HEAD
// never actually wrote authenticated bytes on the H/2 socket, Chrome's
// connection pool wasn't convinced the parked socket was dead. The
// founder's next click 401'd on the SAME parked socket, hung 13s
// (timeout + React-Query retry on the same stale token), and the UI
// sat on spinners.
//
// FIX:
//   (1) await supabase.auth.getSession() so auth-js's own state is
//       authoritative for this tab.
//   (2) If the access token is expired / near-expiry (<30s), call
//       supabase.auth.refreshSession(). This is a real authenticated
//       round-trip to /auth/v1/token?grant_type=refresh_token — it
//       writes bytes on the socket and gets bytes back. If the socket
//       was dead, the write fails locally and Chrome opens a fresh one.
//   (3) Fire ONE small AUTHENTICATED probe to PostgREST with the fresh
//       token — GET /rest/v1/board_sync_pings?select=id&limit=1. A 200
//       confirms the socket is healthy; any non-2xx tells us we still
//       need to recover, and the refresh-on-401 layer in timeoutFetch
//       will pick that up on the user's next real action.
// =====================================================================
const VISIBILITY_WARMUP_TIMEOUT_MS = 5_000;
let warming = false;

async function refreshAndProbe(): Promise<void> {
  if (warming) return;
  // Skip if no session in localStorage — anon visitors have nothing to warm.
  try {
    if (!localStorage.getItem('pms.auth')) return;
  } catch {
    return;
  }
  warming = true;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      console.log('[warm] no session, skipping probe');
      return;
    }

    // Refresh if the access token is expired or within 30s of expiry.
    // Belt-and-suspenders against Chrome's background-tab timer
    // throttling — auth-js's autoRefreshToken setTimeout may not have
    // fired while we were hidden, so we don't trust it to be fresh.
    const expiresAt = session.expires_at ?? 0;     // unix seconds
    const nowSec = Math.floor(Date.now() / 1000);
    let token = session.access_token;
    if (expiresAt && expiresAt - nowSec < 30) {
      const { data: refreshed, error } = await supabase.auth.refreshSession();
      if (error || !refreshed.session?.access_token) {
        console.log('[warm] refresh failed:', error?.message ?? '(no session returned)');
        return;
      }
      token = refreshed.session.access_token;
    }

    // Authenticated probe. Real GET that carries the Bearer — forces
    // Chrome to actually write bytes on the H/2 socket. board_sync_pings
    // is cheap (1-row RLS-allowed SELECT). 5s timeout, separate from
    // the global 6s timeoutFetch so the probe never blocks user
    // interaction longer than its own budget. We deliberately bypass
    // timeoutFetch to avoid the refresh-on-401 layer (we just refreshed).
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      try { ctrl.abort(new DOMException('warm-up probe timeout', 'TimeoutError')); }
      catch { ctrl.abort(); }
    }, VISIBILITY_WARMUP_TIMEOUT_MS);
    try {
      const resp = await fetch(`${url}/rest/v1/board_sync_pings?select=id&limit=1`, {
        method: 'GET',
        cache: 'no-store',
        keepalive: true,
        signal: ctrl.signal,
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });
      console.log(`[warm] refreshed + probed ${resp.status}`);
    } catch (e) {
      console.log('[warm] probe failed, reconnecting', (e as Error)?.name ?? e);
    } finally {
      clearTimeout(timer);
    }
  } finally {
    warming = false;
  }
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshAndProbe();
  });
  // window.focus also catches the alt-tab-back case on some platforms.
  window.addEventListener('focus', () => void refreshAndProbe());
}
