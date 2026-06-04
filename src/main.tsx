import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { Toaster } from 'sonner';

import './index.css';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { FullPageSpinner } from '@/components/Spinner';
import { useAuthStore } from '@/state/authStore';
import { useThemeStore } from '@/state/themeStore';
import { attachBoardSyncListener } from '@/lib/boardSync';
import { routeTree } from './routeTree.gen';

// =====================================================================
// QueryClient — defaults tuned for the focus-recovery bug fix.
//
//   refetchOnWindowFocus: false
//     We DO NOT want a stampede on every focus. The
//     AppShell.useRefocusInvalidate hook handles refocus, gated on a
//     sustained-hidden duration (≥5s).
//
//   refetchOnReconnect: true   (NEW)
//     When the browser detects the network coming back online (offline
//     → online transition fires `online` event, which TanStack Query
//     listens to natively), refetch every query. This rescues the
//     "tab was offline / socket parked" case for free, with no extra
//     code from us.
//
//   retry: 1
//     One in-line retry on a failed fetch. Combined with the new
//     timeout-error self-heal below, transient timeouts recover
//     within ~500ms instead of staying stuck forever.
//
// QueryCache.onError — TRANSIENT-TIMEOUT SELF-HEAL.
//   Pre-fix, when timeoutFetch fired its AbortController and the
//   retry also failed, the query went to error state and STAYED
//   there forever (because refetchOnWindowFocus:false everywhere
//   blocked auto-recovery). The user had to manually refresh.
//
//   Now: when a query errors with a TimeoutError / AbortError, we
//   schedule ONE delayed invalidate (~500ms) of that query key. That
//   triggers a single retry on a (likely) freshly-recovered socket.
//   If that also fails, no further auto-heal — the user can refresh,
//   but they won't be stuck on a hung query for a transient network
//   blip.
// =====================================================================
const TRANSIENT_RETRY_DELAY_MS = 500;
function isTransientTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const name = err.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

// =====================================================================
// networkMode: 'always' — DO NOT pause queries on navigator.onLine.
//
// Smoking gun for the "spinner stuck, no network request, must refresh"
// recurrence: React Query v5 default networkMode is 'online', which
// calls onlineManager.isOnline() before every fetch. If navigator
// briefly reports offline (Chrome occasionally does this on alt-tab,
// network-interface switches, or VPN reconnects), the query enters
// fetchStatus: 'paused' and NO network request fires. It only resumes
// when an 'online' event arrives — which won't come if navigator
// stays online the whole time.
//
// Source: node_modules/@tanstack/query-core/src/retryer.ts:53-57
//   canFetch(networkMode) returns onlineManager.isOnline() when mode
//   is 'online', else always true.
//
// 'always' makes canFetch unconditionally true — queries fire
// regardless of navigator.onLine. We get connectivity feedback the
// honest way: the fetch itself either succeeds, returns an error, or
// times out via our timeoutFetch wrapper. No invisible paused state.
//
// Mutations get the same treatment so cell-edit / save / shift-RPC
// mutations don't silently queue when navigator flickers.
// =====================================================================
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: 1,
      networkMode: 'always',
    },
    mutations: {
      networkMode: 'always',
    },
  },
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (!isTransientTimeoutError(error)) return;
      // Single delayed self-heal. If it also fails, give up — we
      // don't want to spin on a genuinely-down endpoint.
      const key = query.queryKey;
      setTimeout(() => {
        // Only invalidate if the query is still in cache AND still in
        // error state. If a subsequent successful refetch already
        // happened, this is a no-op (React Query coalesces).
        const q = queryClient.getQueryCache().find({ queryKey: key });
        if (!q) return;
        if (q.state.status !== 'error') return;
        void queryClient.invalidateQueries({ queryKey: key });
      }, TRANSIENT_RETRY_DELAY_MS);
    },
  }),
});

// Cross-tab live update: any mutation in another tab that publishes a
// boardId via publishBoardChange() triggers this listener to invalidate
// the three board-scoped query keys here, so React Query refetches and
// the UI catches up within one network round-trip. See src/lib/boardSync.ts.
attachBoardSyncListener(queryClient);

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  context: {},
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

function Root() {
  const status = useAuthStore((s) => s.status);
  const initialize = useAuthStore((s) => s.initialize);
  const theme = useThemeStore((s) => s.theme);
  const [ready, setReady] = useState(status !== 'loading');

  useEffect(() => {
    if (status === 'loading') {
      initialize().finally(() => setReady(true));
    } else {
      setReady(true);
    }
  }, [status, initialize]);

  if (!ready) return <FullPageSpinner />;

  return (
    <>
      <RouterProvider router={router} />
      <Toaster
        position="top-right"
        theme={theme}
        toastOptions={{
          style: {
            background: 'var(--bg-surface)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-light)',
          },
        }}
      />
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <Root />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
