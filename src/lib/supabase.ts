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

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'pms.auth',
    lock: inMemoryLock,
  },
});
