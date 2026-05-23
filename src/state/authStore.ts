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
    // Backgrounded browser tabs aggressively throttle setTimeout, so
    // the Supabase auto-refresh timer can sleep past the access-token
    // expiry. When the user returns, the next API call goes out with a
    // dead token and gets a 401, which surfaces as "backend stops
    // working after a few minutes".
    //
    // The fix: when the tab becomes visible OR regains focus, poke
    // Supabase's session API. If the access token is close to expiry
    // (or already expired), this triggers an immediate refresh using
    // the long-lived refresh token, restoring a valid auth header
    // before the user clicks anything.
    //
    // We listen on both events because Chrome fires `visibilitychange`
    // when the tab itself is shown/hidden, while `focus` covers
    // window-level activation (e.g. alt-tabbing back from another app
    // when the tab was already visible).
    // ---------------------------------------------------------------
    if (typeof document !== 'undefined') {
      const wake = () => {
        // Only wake when we believe we're authenticated — no point
        // hitting auth endpoints if the user is on the login screen.
        if (get().status !== 'authenticated') return;
        // Fire-and-forget; the auth-state listener above will update
        // session/profile when the refresh resolves.
        void supabase.auth.getSession().catch((err) => {
          console.warn('[auth] wake getSession failed', err);
        });
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
