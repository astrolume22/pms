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
  // Identifier can be either a username OR a real email — the server-side
  // resolve_login_email RPC (migration 0041) translates it to the auth
  // email Supabase expects.
  signInWithIdentifier: (identifier: string, password: string, remember: boolean) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  setProfile: (profile: UserRow) => void;
}

const INTERNAL_DOMAIN = 'pms.internal';

// Last-resort fallback used only when the resolve RPC errors out (network /
// transient). Mirrors the legacy username→email mapping so a synthetic user
// can still authenticate. Email-shaped identifiers fall through as-is so
// Supabase fails with the same generic error.
function fallbackIdentifierToEmail(id: string): string {
  const trimmed = id.trim().toLowerCase();
  if (trimmed.includes('@')) return trimmed;
  return `${trimmed}@${INTERNAL_DOMAIN}`;
}

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
    // NOTE on idle-tab wake-up:
    //
    // We INTENTIONALLY do not register our own visibilitychange/focus
    // handler that calls refreshSession() here.  An earlier version
    // of this file did, and it caused the "every operation spins
    // forever after a quick tab-switch" bug:
    //
    //   • Supabase's @supabase/auth-js already has its own
    //     visibilitychange listener which calls _recoverAndRefresh()
    //     when the tab becomes visible. That handler acquires the
    //     auth lock.
    //   • Our manual `supabase.auth.refreshSession()` on the same
    //     event ALSO acquires the auth lock.
    //   • Both ran in the same microtask after visibility change.
    //     Combined with a fragile lock implementation, the contention
    //     wedged the lock and every later `supabase.from(...)` (which
    //     calls getSession internally) hung forever.
    //
    // The lock has since been rewritten to be deadlock-proof (see
    // `lib/supabase.ts`), but the right fix is to ALSO drop the
    // redundant wake handler so we don't race the library at all.
    //
    // What still works without it:
    //   • Supabase's built-in visibility handler refreshes the session
    //     when the tab becomes visible.
    //   • The 15s fetch timeout in `lib/supabase.ts` guarantees no
    //     individual request hangs longer than 15s — if a stale
    //     HTTP/2 socket parks a request, it aborts and the user gets
    //     a clear error (and the next call opens a fresh socket).
    //   • TOKEN_REFRESHED below keeps our session state in sync when
    //     auth-js rotates the token.
    // ---------------------------------------------------------------
  },

  signInWithIdentifier: async (identifier, password, _remember) => {
    // _remember is reserved for future "long session" tweak; supabase already
    // uses long-lived refresh tokens by default, so we accept and ignore.
    //
    // Resolve the typed identifier (username OR email) to the auth.users
    // email Supabase expects. The RPC (migration 0041, SECURITY DEFINER,
    // anon-grantable) returns ONLY the email column for active users and
    // NULL otherwise — never raises. NULL ⇒ feed the original identifier
    // into signInWithPassword anyway so the failure path is identical to
    // a wrong-password attempt (no enumeration via timing or error text).
    let resolvedEmail: string | null = null;
    try {
      const { data, error } = await supabase.rpc('resolve_login_email', {
        p_identifier: identifier,
      });
      if (!error && typeof data === 'string') resolvedEmail = data;
    } catch {
      // Swallow network / transient errors and fall back to the legacy
      // username→email mapping. Authentication still goes through Supabase
      // normally — we just don't get the email lookup.
    }
    const email = resolvedEmail ?? fallbackIdentifierToEmail(identifier);

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      // Generic message — never leak whether the identifier was the issue.
      throw new Error('Invalid username/email or password');
    }
    const profile = await loadProfile(data.session.user.id);
    if (!profile) {
      await supabase.auth.signOut();
      throw new Error('Invalid username/email or password');
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
