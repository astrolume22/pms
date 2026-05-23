import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { UserRow } from '@/lib/database.types';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthState {
  status: AuthStatus;
  session: Session | null;
  profile: UserRow | null;
  // Actions
  initialize: () => Promise<void>;
  signInWithUsername: (username: string, password: string, remember: boolean) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  setProfile: (profile: UserRow) => void;
}

const INTERNAL_DOMAIN = 'pms.internal';
const usernameToEmail = (username: string) => `${username.trim().toLowerCase()}@${INTERNAL_DOMAIN}`;

async function loadProfile(userId: string): Promise<UserRow | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    console.error('[auth] loadProfile error', error);
    return null;
  }
  return (data as UserRow | null) ?? null;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'loading',
  session: null,
  profile: null,

  initialize: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      const profile = await loadProfile(data.session.user.id);
      set({ status: profile ? 'authenticated' : 'unauthenticated', session: data.session, profile });
    } else {
      set({ status: 'unauthenticated', session: null, profile: null });
    }

    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        set({ status: 'unauthenticated', session: null, profile: null });
        return;
      }
      // TOKEN_REFRESHED fires every time the auto-refresher rotates the
      // access token. The user/profile row hasn't changed, so re-fetching
      // it is pure waste (and burns a network round-trip every refresh).
      // Update the session in-place and keep the existing profile.
      if (event === 'TOKEN_REFRESHED') {
        const existing = get().profile;
        if (existing) {
          set({ session, status: 'authenticated' });
          return;
        }
        // Fall through if we somehow have a session but no profile.
      }
      const profile = await loadProfile(session.user.id);
      set({ status: profile ? 'authenticated' : 'unauthenticated', session, profile });
    });

    // ---------------------------------------------------------------
    // Idle-tab wake handler.
    //
    // The previous version called `getSession()` on visibilitychange,
    // but `getSession()` only reads cached state and only triggers a
    // network refresh if the cached token is *already known* expired.
    // That's not enough: while the tab was hidden, Chrome throttled
    // the auto-refresh timer AND parked the HTTP/2 socket. The next
    // user mutation goes out on a half-dead connection and the fetch
    // sits pending for minutes — hence the infinite spinner the user
    // reported even after the first fix.
    //
    // The right fix has two parts:
    //   1. `lib/supabase.ts` now wraps fetch in a 15s AbortController
    //      timeout, so no request can hang indefinitely.
    //   2. Here we call `refreshSession()` (forces a network round-
    //      trip to /auth/v1/token) — that proactively opens a fresh
    //      connection AND rotates the access token before any user
    //      action lands. The 15s timeout above guarantees the refresh
    //      itself can't hang either.
    //
    // We debounce: visibilitychange + focus often fire together when
    // the user alt-tabs back, and `refreshSession()` is one of the few
    // calls supabase-js can't trivially deduplicate.
    // ---------------------------------------------------------------
    if (typeof document !== 'undefined') {
      let wakeInFlight = false;
      let lastWakeAt   = 0;
      const WAKE_COOLDOWN_MS = 5_000;
      const wake = () => {
        if (get().status !== 'authenticated') return;
        const now = Date.now();
        if (wakeInFlight) return;
        if (now - lastWakeAt < WAKE_COOLDOWN_MS) return;
        wakeInFlight = true;
        lastWakeAt   = now;
        // refreshSession() forces a network call; the fetch wrapper
        // bounds it to 15s. If the refresh fails (network error /
        // expired refresh token), we just log — the next user click
        // will surface a clean error toast via the same path.
        supabase.auth
          .refreshSession()
          .catch((err) => {
            console.warn('[auth] wake refreshSession failed', err);
          })
          .finally(() => { wakeInFlight = false; });
      };
      const onVisible = () => {
        if (document.visibilityState === 'visible') wake();
      };
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('focus', wake);
      // Initialize is called once at app boot, so we intentionally do
      // NOT detach these — they need to live for the app's lifetime.
    }
  },

  signInWithUsername: async (username, password, _remember) => {
    // _remember is reserved for future "long session" tweak; supabase already
    // uses long-lived refresh tokens by default, so we accept and ignore.
    const email = usernameToEmail(username);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      // Throw a generic message — never leak whether the username was the issue.
      throw new Error('Username or password incorrect');
    }
    const profile = await loadProfile(data.session.user.id);
    if (!profile) {
      await supabase.auth.signOut();
      throw new Error('Username or password incorrect');
    }
    if (profile.status !== 'active') {
      await supabase.auth.signOut();
      throw new Error('This account has been deactivated. Contact your admin.');
    }
    set({ status: 'authenticated', session: data.session, profile });
  },

  signOut: async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      // Network failure shouldn't trap the user; clear local state anyway.
      console.warn('[auth] signOut network error, clearing locally', err);
    } finally {
      try {
        localStorage.removeItem('pms.auth');
      } catch {
        /* ignore */
      }
      set({ status: 'unauthenticated', session: null, profile: null });
    }
  },

  refreshProfile: async () => {
    const session = get().session;
    if (!session) return;
    const profile = await loadProfile(session.user.id);
    if (profile) set({ profile });
  },

  setProfile: (profile) => set({ profile }),
}));
