import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, Inbox, Search, Sun, Moon, LogOut, User as UserIcon, Shield } from 'lucide-react';
import { useAuthStore } from '@/state/authStore';
import { useThemeStore } from '@/state/themeStore';
import { Avatar } from '@/components/Avatar';
import { NotificationsPanel } from '@/components/notifications/NotificationsPanel';
import { useUnreadCount } from '@/hooks/notifications';
import { cn } from '@/lib/cn';
import { toast } from 'sonner';

export function TopBar() {
  const profile = useAuthStore((s) => s.profile);
  const signOut = useAuthStore((s) => s.signOut);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const navigate = useNavigate();
  // We clear the react-query cache on sign-out so the next user that
  // logs in on this browser tab doesn't briefly see the previous user's
  // cached boards/items/etc. before the new session refetches.
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const { data: unreadCount = 0 } = useUnreadCount();

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const onSignOut = async () => {
    setOpen(false);
    await signOut();
    // Drop every cached query — boards, items, members, etc. — so the
    // next user logging in on this browser doesn't see the previous
    // user's data flash through before refetch.
    queryClient.clear();
    toast.success('Signed out');
    navigate({ to: '/login' });
  };

  return (
    <header
      className="h-12 flex items-center px-3 shrink-0 select-none"
      style={{ background: 'var(--bg-dark)', color: 'var(--text-on-dark)' }}
    >
      {/* Logo */}
      <Link
        to="/"
        className="flex items-center pr-4 mr-2 border-r border-white/10 h-full"
        aria-label="EIA Projects home"
      >
        <span className="text-[20px] font-bold tracking-wide">EIA Projects</span>
      </Link>

      {/* Search (stub) */}
      <div className="flex-1 max-w-[640px] mx-auto">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/60" />
          <input
            type="text"
            placeholder="Search"
            className="w-full bg-white/10 hover:bg-white/15 focus:bg-white/15 placeholder:text-white/60 text-white text-sm rounded-base h-8 pl-9 pr-3 outline-none transition-colors duration-100"
            disabled
          />
        </div>
      </div>

      {/* Right side */}
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          aria-label="Inbox"
          className="h-8 w-8 inline-flex items-center justify-center rounded-base hover:bg-white/10 text-white/90"
          disabled
        >
          <Inbox className="h-[18px] w-[18px]" />
        </button>
        <div className="relative">
          <button
            type="button"
            aria-label="Notifications"
            onClick={() => setNotifOpen((v) => !v)}
            className="h-8 w-8 inline-flex items-center justify-center rounded-base hover:bg-white/10 text-white/90 relative"
          >
            <Bell className="h-[18px] w-[18px]" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-pill bg-error text-white text-[10px] font-medium inline-flex items-center justify-center">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
          {notifOpen && <NotificationsPanel onClose={() => setNotifOpen(false)} />}
        </div>

        {/* Avatar dropdown */}
        <div className="relative" ref={ref}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="ml-1 inline-flex items-center justify-center rounded-pill h-8 w-8 ring-2 ring-transparent hover:ring-white/30 transition"
            aria-haspopup="menu"
            aria-expanded={open}
          >
            <Avatar name={profile?.full_name ?? profile?.username ?? '?'} url={profile?.avatar_url} size="md" />
          </button>

          {open && profile && (
            <div
              role="menu"
              className="absolute right-0 top-10 w-64 bg-surface text-text-primary border border-border-light rounded-md shadow-lg z-50 overflow-hidden"
            >
              <div className="px-4 py-3 border-b border-border-light">
                <p className="text-sm text-text-secondary">Signed in as</p>
                <p className="text-base font-medium truncate">{profile.full_name ?? profile.username}</p>
                <p className="text-xs text-text-secondary truncate">@{profile.username}</p>
              </div>
              <MenuItem icon={<UserIcon className="h-4 w-4" />} label="My Profile" onClick={() => { setOpen(false); navigate({ to: '/profile' }); }} />
              <MenuItem
                icon={theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                label={theme === 'dark' ? 'Light mode' : 'Dark mode'}
                onClick={() => toggleTheme()}
              />
              {(profile.role === 'admin' || profile.is_super_admin) && (
                <MenuItem
                  icon={<Shield className="h-4 w-4" />}
                  label="Admin Panel"
                  onClick={() => { setOpen(false); navigate({ to: '/admin' }); }}
                />
              )}
              <div className="h-px bg-border-light" />
              <MenuItem icon={<LogOut className="h-4 w-4" />} label="Sign out" onClick={onSignOut} />
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function MenuItem({
  icon, label, onClick,
}: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left px-4 py-2 text-sm flex items-center gap-3',
        'hover:bg-hover transition-colors duration-100',
      )}
      role="menuitem"
    >
      <span className="text-text-secondary">{icon}</span>
      <span>{label}</span>
    </button>
  );
}
