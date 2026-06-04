import { useEffect, useRef } from 'react';
import { Outlet } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { TopBar } from './TopBar';
import { IconRail } from './IconRail';
import { WorkspacePanel } from './WorkspacePanel';
import { useAuthStore } from '@/state/authStore';

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

  useEffect(() => {
    const markHidden = () => {
      if (hiddenSinceRef.current === null) {
        hiddenSinceRef.current = Date.now();
      }
    };
    const onVisibleOrFocus = () => {
      // Only act on the becoming-visible transition. The native
      // `focus` event also fires on document.visibilityState=visible,
      // so we treat them uniformly.
      if (document.visibilityState !== 'visible') return;

      const hiddenSince = hiddenSinceRef.current;
      hiddenSinceRef.current = null;
      // First load — no prior hidden period to compare against.
      if (hiddenSince === null) return;

      const hiddenMs = Date.now() - hiddenSince;
      if (hiddenMs < SUSTAINED_HIDDEN_MS) {
        // Sub-5s blur — sub-second alt-tab, brief click elsewhere,
        // mouse leaving the window. NO-OP. The whole point of this
        // fix: the storm of refetches must not fire on these brief
        // events.
        return;
      }

      const cutoff = Date.now() - STALE_WINDOW_MS;
      void qc.invalidateQueries({
        predicate: (q) => {
          if (q.state.dataUpdatedAt >= cutoff) return false;
          const root = q.queryKey[0];
          return typeof root === 'string' && REFOCUS_QUERY_ROOTS.includes(root);
        },
      });
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') markHidden();
    };
    document.addEventListener('visibilitychange', onHidden);
    document.addEventListener('visibilitychange', onVisibleOrFocus);
    window.addEventListener('blur', markHidden);
    window.addEventListener('focus', onVisibleOrFocus);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      document.removeEventListener('visibilitychange', onVisibleOrFocus);
      window.removeEventListener('blur', markHidden);
      window.removeEventListener('focus', onVisibleOrFocus);
    };
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
