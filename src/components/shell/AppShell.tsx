import { useEffect, useRef } from 'react';
import { Outlet } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { TopBar } from './TopBar';
import { IconRail } from './IconRail';
import { WorkspacePanel } from './WorkspacePanel';
import { useAuthStore } from '@/state/authStore';
import { DIAG, diag, logStuckQueries } from '@/lib/diag';

// =====================================================================
// Simplified data-loading model (founder decision):
//
// All focus-driven query machinery has been REMOVED from this shell.
// A tab refocus is now a complete no-op at the shell level — no
// invalidate, no paused-kick, no zombie-fetch rekick, no blur/focus/
// visibilitychange listeners, no online/offline diag. Data simply
// loads when a page mounts; to see another machine's changes the user
// refreshes / reopens the board (cross-machine live sync is
// intentionally dropped here).
//
// Paired with src/lib/supabase.ts having autoRefreshToken:false, this
// means a refocus event causes ZERO supabase activity. The only thing
// that ever touches auth on focus is the user themselves clicking
// something, and tokens rotate lazily via timeoutFetch's 401-retry.
// =====================================================================
export function AppShell() {
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

  // ===================================================================
  // DIAG-ONLY: passive focus/visibilitychange logger. NO invalidate,
  // NO refetch, NO setInterval, NO cache walk other than the one-shot
  // logStuckQueries report. This is the bare-minimum instrumentation
  // we need to answer: "on refocus, does a fetch fire and hang, or
  // does it not fire at all?" — without re-introducing any of the
  // focus-driven query machinery that was deliberately ripped out at
  // commit e3b2055 (and don't re-introduce queryWatchdog from ec59373).
  // ===================================================================
  const qc = useQueryClient();
  const hiddenSinceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!DIAG) return;
    const onHidden = () => {
      if (document.visibilityState === 'hidden') {
        hiddenSinceRef.current = Date.now();
        diag('focus', 'hidden  at=' + new Date().toISOString());
      }
    };
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const since = hiddenSinceRef.current;
      const hiddenMs = since === null ? 0 : Date.now() - since;
      hiddenSinceRef.current = null;
      diag('focus', 'VISIBLE hiddenMs=' + hiddenMs
        + '  onLine=' + navigator.onLine
        + '  hasFocus=' + document.hasFocus()
        + '  at=' + new Date().toISOString());
      // One-shot cache snapshot on refocus. Pure read; no mutation.
      logStuckQueries(qc, 'focus.return');
      diag('focus', 'NO invalidate, NO refetch — shell is intentionally inert on focus');
    };
    document.addEventListener('visibilitychange', onHidden);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('blur', onHidden);
    diag('focus', 'listeners attached (DIAG only — log-only, no behavior change)');
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('blur', onHidden);
    };
  }, [qc]);

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
