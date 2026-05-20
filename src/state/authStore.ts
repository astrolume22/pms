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
      const profile = await loadProfile(session.user.id);
      set({ status: profile ? 'authenticated' : 'unauthenticated', session, profile });
    });
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
