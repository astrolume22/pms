import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from './authStore';

type Theme = 'light' | 'dark';

const STORAGE_KEY = 'pms.theme';

function readInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

function applyThemeToDocument(theme: Theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');
  root.dataset.theme = theme;
}

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
  hydrateFromProfile: (theme: Theme) => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: (() => {
    const initial = readInitialTheme();
    applyThemeToDocument(initial);
    return initial;
  })(),
  setTheme: (theme) => {
    applyThemeToDocument(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
    set({ theme });
    // Persist to the user's profile (best-effort). If the network is
    // dead the toggle still works locally via the localStorage write
    // above; we just won't sync the preference. The 15s fetch timeout
    // in lib/supabase.ts guarantees this won't hang the UI.
    const profile = useAuthStore.getState().profile;
    if (profile && profile.theme !== theme) {
      void supabase
        .from('users')
        .update({ theme } as never)
        .eq('id', profile.id)
        .then(({ error }) => {
          if (error) {
            console.warn('[theme] persist failed (kept locally):', error.message);
            return;
          }
          void useAuthStore.getState().refreshProfile();
        });
    }
  },
  toggle: () => get().setTheme(get().theme === 'light' ? 'dark' : 'light'),
  hydrateFromProfile: (theme) => {
    if (theme === get().theme) return;
    applyThemeToDocument(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
    set({ theme });
  },
}));
