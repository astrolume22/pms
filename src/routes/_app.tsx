import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { useAuthStore } from '@/state/authStore';
import { useThemeStore } from '@/state/themeStore';
import { FullPageSpinner } from '@/components/Spinner';

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ location }) => {
    // Wait for the auth store to resolve at least once.
    const state = useAuthStore.getState();
    if (state.status === 'loading') {
      await state.initialize();
    }
    const after = useAuthStore.getState();
    if (after.status !== 'authenticated' || !after.profile) {
      const redirectTarget = location.pathname + (location.searchStr ?? '');
      throw redirect({ to: '/login', search: { redirect: redirectTarget } });
    }
  },
  component: AppLayout,
});

function AppLayout() {
  const status = useAuthStore((s) => s.status);
  const profileTheme = useAuthStore((s) => s.profile?.theme);
  const hydrate = useThemeStore((s) => s.hydrateFromProfile);
  const navigate = useNavigate();

  // Sync theme from the user's saved preference once we have a profile.
  useEffect(() => {
    if (profileTheme) hydrate(profileTheme);
  }, [profileTheme, hydrate]);

  // Mid-session sign-out / refresh-token-died safety net.
  // beforeLoad only runs at navigation time. If the auth state flips to
  // 'unauthenticated' WHILE the user is already inside the app shell
  // (e.g. the refresh-token expired during a long idle, or another tab
  // signed out), nothing routes them back to /login — they stay on a
  // shell that's trying to render with `profile === null`, which crashes
  // various child components. This effect pushes them to /login the
  // moment auth state goes away.
  useEffect(() => {
    if (status === 'unauthenticated') {
      navigate({ to: '/login' });
    }
  }, [status, navigate]);

  if (status === 'loading') return <FullPageSpinner />;
  return <AppShell />;
}
