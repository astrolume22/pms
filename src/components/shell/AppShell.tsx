import { useEffect, useRef } from 'react';
import { Outlet } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { TopBar } from './TopBar';
import { IconRail } from './IconRail';
import { WorkspacePanel } from './WorkspacePanel';
import { useAuthStore } from '@/state/authStore';
import { DIAG, diag, logStuckQueries } from '@/lib/diag';

// =====================================================================
// useRefocusInvalidate — when the tab comes back from a SUSTAINED
// hidden / unfocused period, invalidate stale board + shift queries so
// the UI catches up to any changes another tab / machine made while
// we were away.
//
// CRITICAL: this runs ONLY when the tab was hidden for >= 5 seconds.
// A sub-second blur→focus (the founder's pattern of glancing at
// another window then coming back) is a strict NO-OP. The previous
// version invalidated on EVERY focus event, which combined with a
// tight 3s timeout created a refetch-storm that left queries stuck in
// error state and forced a manual reload — exactly the bug we are
// fixing here.
//
// We also NARROW the predicate to specific board/shift query roots
// (instead of "every stale query"). Notifications, auth-related
// queries, etc. don't need a refetch storm on refocus — they have
// their own intervals.
// =====================================================================
const SUSTAINED_HIDDEN_MS = 5_000;
const STALE_WINDOW_MS = 60_000;

// Query-key root prefixes that get invalidated on sustained refocus.
// Read from src/hooks/{items,groups,columns}.ts + src/hooks/shift.ts:
//   items.ts  → ['items','board', <boardId>]
//   groups.ts → ['groups','board', <boardId>]
//   columns.ts→ ['columns','board', <boardId>]
//   shift.ts  → ['shift', 'today' | 'tick', …]
//             → ['admin','shift-control'] / ['admin','locked-shifts'] / ['admin','bio-requests']
//                (admin queries auto-refresh via their own 10s
//                refetchInterval; we DON'T pile on here)
// Polled queries (board_watermark every 3s, useUnreadCount every 30s)
// catch up on their own — no need to add to the storm.
const REFOCUS_QUERY_ROOTS: ReadonlyArray<string> = [
  'items', 'groups', 'columns', 'shift',
];

function useRefocusInvalidate(): void {
  const qc = useQueryClient();
  // Single source of truth for "how long has the tab been hidden /
  // unfocused?" Set the moment we go hidden / blur, cleared the moment
  // we go visible / focus.
  const hiddenSinceRef = useRef<number | null>(null);

  // Belt-and-suspenders for the "spinner stuck, no network request"
  // recurrence: even though main.tsx sets networkMode:'always' on the
  // QueryClient defaults so queries can NEVER enter the paused state,
  // a per-query override or a future regression could re-introduce
  // paused queries. On every focus event we sweep the cache and force
  // a refetch on any query whose fetchStatus is 'paused'. Cheap walk
  // (one O(N) over the cache, no work when nothing is paused), and a
  // hard guarantee that the wedge can't survive a focus event.
  const kickPausedQueries = () => {
    let kicked = 0;
    const paused: (readonly unknown[])[] = [];
    for (const q of qc.getQueryCache().getAll()) {
      if (q.state.fetchStatus === 'paused') {
        paused.push(q.queryKey);
        void q.fetch();
        kicked++;
      }
    }
    if (kicked > 0) {
      console.log(`[refocus] kicked ${kicked} paused queries`);
      if (DIAG) for (const k of paused) diag('refocus.kicked', k);
    }
  };

  // FIX 3 — refocus cancel/refetch for the known wedge-prone roots.
  // Diagnosis confirmed the founder's exact pattern: on a sub-1s
  // blur→focus, queries with these key prefixes go into fetchStatus=
  // 'pending' and never resolve. The cause appears to be a half-dead
  // promise inside React Query that survived the AbortController fire.
  //
  // The cure is mechanical: on every focus, walk these roots and for
  // any query in a stuck-pending state, cancel + refetch. Cancel first
  // so the orphaned promise is discarded; refetch fires a fresh
  // request that actually completes.
  //
  // This is intentionally NARROW: only the board/shift/watermark roots
  // we've seen wedge. Notifications, profile, auth queries are
  // untouched — they have their own refresh cycles and are not
  // implicated in the wedge.
  const recoverStuckBoardQueries = () => {
    let recovered = 0;
    const stuckKeys: (readonly unknown[])[] = [];
    for (const q of qc.getQueryCache().getAll()) {
      const root = q.queryKey[0];
      if (typeof root !== 'string') continue;
      // 'board-watermark' is the founder's confirmed wedge target; the
      // four board roots are the next most likely. shift queries also
      // hit the same code path.
      const inScope =
        root === 'board-watermark' ||
        REFOCUS_QUERY_ROOTS.includes(root);
      if (!inScope) continue;
      const fs = q.state.fetchStatus;
      const s  = q.state.status;
      // Stuck = fetching (no resolution) OR pending+idle (no fetch at all)
      const isStuck = fs === 'fetching' || (s === 'pending' && fs === 'idle');
      if (!isStuck) continue;
      stuckKeys.push(q.queryKey);
      recovered++;
      // Cancel + refetch by key. Cancel awaits internally; refetch
      // fires after.
      void qc.cancelQueries({ queryKey: q.queryKey })
        .then(() => qc.refetchQueries({ queryKey: q.queryKey }))
        .catch(() => { /* watchdog catches what slips through here */ });
    }
    if (recovered > 0) {
      if (DIAG) {
        diag('refocus', 'recovered ' + recovered + ' stuck board/shift queries');
        for (const k of stuckKeys) diag('refocus.cancelled', k);
      }
    }
  };

  useEffect(() => {
    const markHidden = (origin: string) => {
      if (hiddenSinceRef.current === null) {
        hiddenSinceRef.current = Date.now();
      }
      // DIAG candidates #6, #7, #8 all key off this transition. We log
      // the trigger (blur / visibilitychange-hidden), navigator.onLine,
      // document.hasFocus(), document.visibilityState, and the current
      // hiddenSinceRef so the founder can watch the guards flip.
      if (DIAG) diag('focus', 'HIDDEN via ' + origin +
        '  onLine=' + navigator.onLine +
        '  visibilityState=' + document.visibilityState +
        '  hasFocus=' + document.hasFocus() +
        '  hiddenSinceRef=' + hiddenSinceRef.current);
    };
    const onVisibleOrFocus = (origin: string) => {
      // Only act on the becoming-visible transition. The native
      // `focus` event also fires on document.visibilityState=visible,
      // so we treat them uniformly.
      if (document.visibilityState !== 'visible') return;

      const hiddenSince = hiddenSinceRef.current;
      const hiddenMs = hiddenSince === null ? 0 : Date.now() - hiddenSince;

      // DIAG: log the full focus-return state so we can correlate with
      // realtime status, fetch lines, and watermark ticks afterwards.
      if (DIAG) diag('focus', 'VISIBLE via ' + origin +
        '  onLine=' + navigator.onLine +
        '  hiddenMs=' + hiddenMs +
        '  visibilityState=' + document.visibilityState +
        '  hasFocus=' + document.hasFocus());
      // Walk the cache RIGHT AFTER refocus and report any stuck queries
      // (paused / pending / errored). Candidates #4 and #8 both show
      // up here. The output is bounded (max 1 line per cache entry) and
      // only fires when there's something interesting.
      if (DIAG) logStuckQueries(qc, 'focus(' + origin + ')');

      // Always run the paused-query sweep, regardless of how long we
      // were hidden. If nothing is paused (the expected case with
      // networkMode:'always'), this is a no-op.
      kickPausedQueries();

      // FIX 3 — also actively recover any board/shift queries that
      // were already pending when we got hidden, in case the in-flight
      // fetch silently died while the tab was backgrounded. Cheap walk
      // (≤ a few dozen queries match the scope predicate) and a no-op
      // when nothing is stuck.
      recoverStuckBoardQueries();

      hiddenSinceRef.current = null;
      // First load — no prior hidden period to compare against.
      if (hiddenSince === null) return;

      if (hiddenMs < SUSTAINED_HIDDEN_MS) {
        // Sub-5s blur — sub-second alt-tab, brief click elsewhere,
        // mouse leaving the window. NO-OP for the invalidate-storm.
        if (DIAG) diag('focus', 'sub-' + SUSTAINED_HIDDEN_MS + 'ms refocus — NO invalidate (hiddenMs=' + hiddenMs + ')');
        return;
      }

      const cutoff = Date.now() - STALE_WINDOW_MS;
      if (DIAG) diag('focus', 'sustained refocus (' + hiddenMs + 'ms) — invalidating ' + REFOCUS_QUERY_ROOTS.join(','));
      void qc.invalidateQueries({
        predicate: (q) => {
          if (q.state.dataUpdatedAt >= cutoff) return false;
          const root = q.queryKey[0];
          return typeof root === 'string' && REFOCUS_QUERY_ROOTS.includes(root);
        },
      });
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') markHidden('visibilitychange');
    };
    const onBlur     = () => markHidden('window.blur');
    const onFocus    = () => onVisibleOrFocus('window.focus');
    const onVisFire  = () => onVisibleOrFocus('visibilitychange');
    // Candidate #6 instrumentation — log navigator.onLine flips. Pure
    // log, no behaviour change. We do NOT pause anything on offline
    // (networkMode:'always' covers that). We just want to SEE whether
    // navigator flickers offline during the bug window.
    const onOnline   = () => { if (DIAG) diag('online', 'navigator -> online'); };
    const onOffline  = () => { if (DIAG) diag('online', 'navigator -> OFFLINE'); };
    document.addEventListener('visibilitychange', onHidden);
    document.addEventListener('visibilitychange', onVisFire);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    if (DIAG) diag('focus', 'listeners attached  initial onLine=' + navigator.onLine +
      '  visibilityState=' + document.visibilityState);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      document.removeEventListener('visibilitychange', onVisFire);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc]);
}

export function AppShell() {
  useRefocusInvalidate();
  // UI polish (batch item 3): the left sidebar (IconRail = workspace
  // switcher, WorkspacePanel = Boards list + "Add new") is admin/super
  // only. Managers see no sidebar — they get only the board area, full
  // width. The role gate matches the server's is_admin() SQL helper
  // (role='admin' OR is_super_admin), the same shape used elsewhere in
  // the codebase (e.g. BoardContent's canEdit). Non-admins are routed
  // directly to their first subscribed board by _app.index.tsx, so
  // hiding the sidebar doesn't strand them.
  const profile = useAuthStore((s) => s.profile);
  const isAdmin = !!profile && (profile.role === 'admin' || profile.is_super_admin);

  return (
    <div className="h-screen flex flex-col bg-app text-text-primary">
      <TopBar />
      <div className="flex-1 flex min-h-0">
        {isAdmin && (
          <>
            <IconRail />
            <WorkspacePanel />
          </>
        )}
        <main className="flex-1 min-w-0 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
