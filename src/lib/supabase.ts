import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing Supabase env. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local',
  );
}

// =====================================================================
// In-memory mutex for Supabase auth
// ---------------------------------------------------------------------
// History: the default browser lock in @supabase/auth-js calls
// `navigator.locks.request('lock:<storageKey>', { mode: 'exclusive' }, fn)`,
// which is shared across ALL tabs of the same origin. A crashed/stale
// prior tab could hold the lock and deadlock every getSession() call
// in subsequent tabs. We swapped to an in-memory tab-local lock.
//
// The first implementation chained Promise resolutions naively:
//   inMemoryLocks.set(name, prior.then(() => gate))
// That has three real problems we hit in production:
//
//   (a) It IGNORED `acquireTimeoutMs`. Supabase auth-js calls our lock
//       with timeout=0 in some paths (e.g. inside `getSession()`),
//       expecting the lock to throw `LockAcquireTimeout` immediately so
//       it can fall through to a non-locked storage read. Silently
//       queuing those calls means every `supabase.from(...)` (which
//       internally calls getSession to attach the auth header) piles
//       up behind any in-flight refresh.
//
//   (b) If `prior` REJECTS, `prior.then(() => gate)` rejects too —
//       skipping the gate. The next acquirer's `await prior.catch(...)`
//       returns instantly and they run `fn()` CONCURRENTLY with the
//       prior. The lock silently fails to mutually exclude.
//
//   (c) If `fn()` of some holder NEVER SETTLES (e.g. two concurrent
//       refreshes racing on localStorage, or an internal Supabase
//       state machine wedging on a never-fulfilled storage adapter),
//       `gate` is never released. Every later acquirer waits forever.
//       Because PostgREST calls go through getSession → through the
//       lock, EVERY data-layer call hangs at the lock — never reaching
//       the fetch wrapper below, so the 15s fetch timeout can't save
//       us either. That's the "every operation spins forever after
//       a quick tab switch, no error in console" bug.
//
// This rewrite addresses all three:
//
//   • Each acquisition has its OWN release gate. We never reach into
//     a chain whose health we don't control.
//   • The "next acquirer waits for me" link uses `.then(ok, err)`
//     with BOTH handlers returning `ourGate` — so even if `prior`
//     rejected, the chain still resolves when WE release. Rejected
//     prior never poisons the chain.
//   • `acquireTimeoutMs === 0` ⇒ "try-acquire": succeed iff the prior
//     tail has already settled (we yield to one microtask and check);
//     otherwise free our gate and throw `LockAcquireTimeout`. Supabase
//     auth-js catches that and falls through to its non-locked path.
//   • `acquireTimeoutMs > 0` ⇒ bounded wait. If the timer wins, we
//     proceed anyway — accepting reduced mutual exclusion in exchange
//     for liveness. Supabase tolerates duplicate refreshes (one wins,
//     the other retries with the new token).
//   • `release()` is always called in `finally`, so a thrown / rejected
//     fn never leaves a permanently-locked gate behind.
// =====================================================================
interface LockState {
  tail: Promise<void>;   // resolves when the LAST queued holder releases
  inFlight: number;      // count of acquirers between acquire and release
}
const lockStates = new Map<string, LockState>();

class LockAcquireTimeout extends Error {
  constructor(name: string) {
    super(`Could not acquire lock '${name}' (acquireTimeoutMs=0)`);
    this.name = 'LockAcquireTimeout';
  }
}

async function inMemoryLock<R>(
  name: string,
  acquireTimeoutMs: number,
  fn: () => Promise<R>,
): Promise<R> {
  // Read state SYNCHRONOUSLY so try-acquire (timeoutMs=0) gets a
  // race-free answer. Using a Promise-state probe across microtasks
  // is racy — `priorSettled.then(cb)` always needs at least one extra
  // microtask to fire `cb` even when the promise is already resolved,
  // which made the previous try-acquire spuriously throw.
  const prevState = lockStates.get(name);
  const isFree = !prevState || prevState.inFlight === 0;

  // Try-acquire (used by supabase-js getSession): fast-fail so the
  // caller can fall through to its non-locked path.
  if (acquireTimeoutMs === 0 && !isFree) {
    throw new LockAcquireTimeout(name);
  }

  // Build our release gate and atomically advance the tail. The
  // `.then(ok, err)` pattern with BOTH handlers returning `ourGate`
  // means the next acquirer waits for OUR gate even if `prior`
  // rejected — a rejected prior can never break the chain.
  const priorTail = prevState?.tail ?? Promise.resolve();
  let release!: () => void;
  const ourGate = new Promise<void>((res) => { release = res; });
  const newTail = priorTail.then(() => ourGate, () => ourGate);

  const state: LockState = prevState ?? { tail: newTail, inFlight: 0 };
  state.tail = newTail;
  state.inFlight += 1;
  lockStates.set(name, state);

  // Wait for the prior tail to settle. We bound the wait based on
  // `acquireTimeoutMs`:
  //   • >0: race against a timer. If the timer wins, proceed anyway
  //         (force-acquire) — accepting reduced mutual exclusion in
  //         exchange for liveness. Supabase tolerates duplicate
  //         refreshes; permanent deadlock is unacceptable.
  //   • =0: lock was free above (we verified !inFlight), so the
  //         prior chain is already a resolved promise. Awaiting it
  //         settles in one microtask. No timer needed.
  //   •  -ve / undef: wait indefinitely (legacy callers).
  // Whatever we await, we use `.then(ok, err)` so a rejected priorTail
  // is treated as "done" and never re-throws.
  const priorSettled = priorTail.then(() => undefined, () => undefined);

  if (acquireTimeoutMs > 0) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<'timeout'>((res) => {
      timer = setTimeout(() => res('timeout'), acquireTimeoutMs);
    });
    try {
      const outcome = await Promise.race([
        priorSettled.then(() => 'acquired' as const),
        timedOut,
      ]);
      if (outcome === 'timeout') {
        console.warn(
          `[auth-lock] '${name}' acquire timed out after ${acquireTimeoutMs}ms; force-acquiring`,
        );
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  } else {
    await priorSettled;
  }

  try {
    return await fn();
  } finally {
    // Always release — even on throw, even on abort, even on
    // force-acquire — so the chain can progress and no future acquirer
    // hangs on a dead gate.
    state.inFlight -= 1;
    release();
  }
}

// =====================================================================
// Hard-timeout fetch wrapper.
// ---------------------------------------------------------------------
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
//   token-refresh request hangs, callers need to know fast.
//
//   Once the dead socket fails a request, Chrome opens a fresh
//   connection for the next call — so a single user-visible failure
//   self-heals every subsequent call.
// =====================================================================
const HARD_TIMEOUT_MS = 15_000;

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
    lock: inMemoryLock,
  },
  global: {
    // Every PostgREST / Storage / Realtime call routes through this.
    // Auth-endpoint calls use their own fetch path inside supabase-js
    // but they also honour `global.fetch` for the actual HTTP request.
    fetch: timeoutFetch,
  },
});
