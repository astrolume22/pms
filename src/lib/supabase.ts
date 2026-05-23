import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing Supabase env. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local',
  );
}

// ---------------------------------------------------------------------
// In-memory lock for Supabase auth
//
// The default browser lock in @supabase/auth-js wraps every session read
// in `navigator.locks.request('lock:<storageKey>', { mode: 'exclusive' }, fn)`.
// That lock is shared across ALL tabs of the same origin, so a stale or
// crashed prior tab can hold the lock and deadlock every subsequent
// `getSession()` call — the app gets stuck on the loading spinner with
// no console error and no network request.  We hit this and confirmed it
// via `navigator.locks.query()` (one client held, one pending, neither
// progressed).
//
// This implementation:
//   • Serializes calls WITHIN the current tab via a promise chain
//     (same JS context → no real races to worry about).
//   • Is independent across tabs.  If two tabs both try to refresh
//     simultaneously, Supabase tolerates the duplicate refresh: one wins,
//     the other retries with the new token.
// ---------------------------------------------------------------------
const inMemoryLocks = new Map<string, Promise<unknown>>();

async function inMemoryLock<R>(
  name: string,
  _acquireTimeoutMs: number,
  fn: () => Promise<R>,
): Promise<R> {
  const prior = inMemoryLocks.get(name) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((res) => { release = res; });
  inMemoryLocks.set(name, prior.then(() => gate));
  try {
    await prior.catch(() => undefined);   // wait for previous holder, ignore its errors
    return await fn();
  } finally {
    release();
  }
}

// ---------------------------------------------------------------------
// Hard-timeout fetch wrapper.
//
// Why this exists:
//   When a tab idles in the background, Chrome aggressively throttles
//   timers AND parks the OS-level HTTP/2 socket.  When the user comes
//   back, the next request goes out on a half-dead connection.  The
//   browser may take MINUTES to notice the socket is broken (it waits
//   on OS TCP keepalive), during which fetch() sits there pending and
//   never resolves.  No 401, no error, no retry — the UI just spins
//   forever.
//
//   This wrapper attaches an AbortController to every Supabase fetch
//   so any request that doesn't complete in HARD_TIMEOUT_MS rejects
//   with a TimeoutError.  The caller's mutation/query then rejects
//   cleanly, react-query unwinds the loading state, and the user can
//   retry — instead of an infinite spinner.
//
//   We respect the caller's `init.signal` so AbortController plumbing
//   from react-query / the route still works.  We pass through every
//   other init option.  Auth endpoints get the SAME timeout — if the
//   token-refresh request hangs, the wake-up retry path needs to know.
//
//   Once the dead socket fails a request, Chrome opens a fresh
//   connection for the next call — so a single user-visible failure
//   self-heals every subsequent call.
// ---------------------------------------------------------------------
const HARD_TIMEOUT_MS = 15_000;

function timeoutFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const external = init?.signal;
  // If the caller already aborted, mirror that into our controller so
  // the downstream fetch sees a single combined signal.
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
      // DOMException with name "TimeoutError" is the standard signal for
      // a client-side timeout — react-query / sonner can detect it.
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
    lock: inMemoryLock,
  },
  global: {
    // Every PostgREST / Storage / Realtime call routes through this.
    // Auth-endpoint calls use their own fetch path inside supabase-js
    // but they also honour `global.fetch` for the actual HTTP request.
    fetch: timeoutFetch,
  },
});
