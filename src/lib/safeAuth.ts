/**
 * safeGetSession — Promise.race guarded wrapper around
 * supabase.auth.getSession().
 *
 * Why this exists:
 *   The "tab loses focus then must refresh" bug had its smoking gun in
 *   auth-js's _acquireLock chain getting orphaned by the previous
 *   passThroughLock shim. We've removed the shim (commit f8e38d5), so
 *   the standard navigator.locks mutex now serializes the auth calls
 *   correctly. But OUR application code still has several places that
 *   await supabase.auth.getSession() directly:
 *
 *     - src/state/authStore.ts initialize()           — boot-time
 *     - src/components/shift/ShiftDriver.tsx          — before email POST
 *     - src/components/shift/BreakControls.tsx        — before email POST
 *     - src/components/board/InviteModal.tsx          — before invite POST
 *     - src/hooks/ai-build.ts, ai-admin.ts            — before AI POST
 *     - src/routes/_bare.reset-password.tsx           — password-reset flow
 *
 *   If ANY of these awaits ever hangs (whether due to a recurrence of
 *   the lock issue, a Chrome quirk we haven't seen yet, or a future
 *   regression), the calling component sits there forever and the UI
 *   feature backed by that component appears broken — looking like the
 *   founder's "must refresh" symptom.
 *
 *   This wrapper hard-bounds every OUR-side getSession() at 8 seconds.
 *   If auth-js doesn't return by then, we return null and let the
 *   caller decide what to do (typically: skip the optional fire-and-
 *   forget POST and let the next user action try again).
 *
 * Boundaries:
 *   - We do NOT wrap auth-js's INTERNAL getSession calls (the ones
 *     inside supabase.from() that attach the auth header). Those run
 *     under the lib's own lock; wrapping them would be a layering
 *     violation. The 401-retry path in src/lib/supabase.ts handles
 *     stale tokens for those.
 *   - We do NOT wrap supabase.auth.onAuthStateChange — that's a
 *     subscription, not a one-shot.
 *
 * Behavior:
 *   - Returns the supabase.auth.getSession() result on success.
 *   - On hard timeout (8s) returns {data:{session:null}, error:null}
 *     and logs a console.warn. The caller's downstream logic should
 *     handle `session === null` the same way it does for a logged-out
 *     visitor (skip the call, show a toast, etc.).
 *
 * Diagnostic logs:
 *   When DIAG is true, each call logs '[diag] getSession start (<tag>)'
 *   on entry and '[diag] getSession done (<tag>) in Xms' on exit. A
 *   `start` log without a matching `done` in the founder's DevTools
 *   confirms a hang at that exact call site. Flip DIAG to false later
 *   to silence.
 */
import type { Session, AuthError } from '@supabase/supabase-js';
import { supabase } from './supabase';

const SAFE_GET_SESSION_TIMEOUT_MS = 8_000;

// Temporary diagnostic flag. Keep on while we hunt the focus-wedge
// recurrence; flip to false once the founder confirms the bug is dead.
const DIAG = true;

export interface SafeGetSessionResult {
  data: { session: Session | null };
  error: AuthError | null;
  /** True iff the call timed out (vs. resolved normally). */
  timedOut: boolean;
}

let callCounter = 0;

export async function safeGetSession(tag: string = 'anon'): Promise<SafeGetSessionResult> {
  const id = ++callCounter;
  const start = Date.now();
  if (DIAG) console.log(`[diag] getSession start (${tag} #${id})`);

  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<SafeGetSessionResult>((resolve) => {
    timer = setTimeout(() => {
      console.warn(
        `[safeGetSession] TIMEOUT after ${SAFE_GET_SESSION_TIMEOUT_MS}ms for tag=${tag} #${id}` +
        ` — auth-js getSession did not resolve. Returning {session:null}.`,
      );
      resolve({ data: { session: null }, error: null, timedOut: true });
    }, SAFE_GET_SESSION_TIMEOUT_MS);
  });

  const realPromise = (async (): Promise<SafeGetSessionResult> => {
    try {
      const { data, error } = await supabase.auth.getSession();
      return { data: { session: data.session ?? null }, error, timedOut: false };
    } catch (e) {
      console.warn(`[safeGetSession] threw for tag=${tag} #${id}:`, e);
      return { data: { session: null }, error: null, timedOut: false };
    }
  })();

  const result = await Promise.race([realPromise, timeoutPromise]);
  if (timer !== null) clearTimeout(timer);
  if (DIAG) console.log(`[diag] getSession done (${tag} #${id}) in ${Date.now() - start}ms timedOut=${result.timedOut}`);
  return result;
}

// One-shot init log so we can confirm the no-custom-lock build is live.
// Logged exactly once per page load. The founder should see this in
// DevTools the moment they open the app — if they don't, the deploy
// didn't land.
if (DIAG && typeof window !== 'undefined') {
  // Defer to next microtask so the console.log shows up AFTER the
  // module-load logs from supabase-js itself, making the order obvious.
  void Promise.resolve().then(() => {
    console.log('[diag] supabase auth lock = native/none (no passThroughLock)');
  });
}
