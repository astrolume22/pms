/**
 * Phase 6 — Admin Users management.
 *
 * Lists every user (incl. deactivated), shows last-active, and exposes
 * Add User / Reset password / Change role / Deactivate-reactivate
 * actions. Every write goes through a SECURITY DEFINER RPC in
 * migration 0018 so the role + super-admin guards live server-side.
 *
 * NO emails are shown anywhere — Monday-style internal username only.
 */
import { useState } from 'react';
import { toast } from 'sonner';
import {
  UserPlus, KeyRound, ShieldCheck, ShieldOff, MoreHorizontal,
  Eye, EyeOff, Crown, AlertTriangle, RefreshCw, AtSign, Trash2, RotateCcw,
} from 'lucide-react';
import { Modal } from '@/components/Modal';
import { Avatar } from '@/components/Avatar';
import { RoleBadge } from '@/components/RoleBadge';
import { Spinner } from '@/components/Spinner';
import { EmptyMessage } from '@/components/EmptyMessage';
import {
  useAdminUsers, useAdminCreateUser, useAdminResetPassword,
  useAdminSetRole, useAdminSetStatus, useAdminSetUsername,
  useAdminDeleteUser, useMarkTeamblueRotated,
  type AdminUserRow,
} from '@/hooks/admin';
import { useAuthStore } from '@/state/authStore';
import type { UserRole } from '@/lib/database.types';
import { cn } from '@/lib/cn';

export function UsersSection() {
  const { data: users, isLoading, refetch, isFetching } = useAdminUsers();
  const profile = useAuthStore((s) => s.profile);
  const [addOpen, setAddOpen] = useState(false);
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);
  const [resetForUser, setResetForUser] = useState<AdminUserRow | null>(null);
  const [roleForUser, setRoleForUser] = useState<AdminUserRow | null>(null);
  // 0042: admin-only rename of a user's display username.
  const [renameForUser, setRenameForUser] = useState<AdminUserRow | null>(null);
  // 0043: admin-only permanent delete (with type-to-confirm gate).
  const [deleteForUser, setDeleteForUser] = useState<AdminUserRow | null>(null);

  return (
    <section className="bg-surface border border-border-light rounded-md p-6">
      <header className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">Users</h2>
          <p className="text-sm text-text-secondary">
            Manage all internal accounts. No emails — usernames only.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            title="Refresh"
            className="h-9 w-9 inline-flex items-center justify-center rounded-base text-text-secondary hover:bg-hover disabled:opacity-40"
            aria-label="Refresh"
          >
            <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
          </button>
          <button type="button" onClick={() => setAddOpen(true)} className="btn-primary inline-flex items-center gap-2">
            <UserPlus className="h-4 w-4" />
            Add user
          </button>
        </div>
      </header>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Spinner className="h-6 w-6 text-brand" />
        </div>
      ) : !users || users.length === 0 ? (
        <EmptyMessage title="No users yet" description="Click Add user to create the first account." />
      ) : (
        // No overflow wrapper — the table fits within the admin panel's
        // 1000px max-width, and the row "..." menu needs to overflow
        // vertically when it opens near the bottom of the list.
        <div>
          <table className="w-full text-left">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-text-secondary border-b border-border-light">
                <th className="py-2 pr-3 font-semibold">User</th>
                <th className="py-2 pr-3 font-semibold">Role</th>
                <th className="py-2 pr-3 font-semibold">Status</th>
                <th className="py-2 pr-3 font-semibold">Last active</th>
                <th className="py-2 pr-1 font-semibold w-10" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <UserRowItem
                  key={u.id}
                  user={u}
                  isCurrent={u.id === profile?.id}
                  menuOpen={menuOpenFor === u.id}
                  onToggleMenu={() => setMenuOpenFor((prev) => (prev === u.id ? null : u.id))}
                  onResetPassword={() => { setMenuOpenFor(null); setResetForUser(u); }}
                  onChangeRole={() => { setMenuOpenFor(null); setRoleForUser(u); }}
                  onRenameUsername={() => { setMenuOpenFor(null); setRenameForUser(u); }}
                  onDeletePermanently={() => { setMenuOpenFor(null); setDeleteForUser(u); }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddUserModal open={addOpen} onClose={() => setAddOpen(false)} />
      {resetForUser && (
        <ResetPasswordModal user={resetForUser} onClose={() => setResetForUser(null)} />
      )}
      {roleForUser && (
        <ChangeRoleModal user={roleForUser} onClose={() => setRoleForUser(null)} />
      )}
      {renameForUser && (
        <RenameUsernameModal user={renameForUser} onClose={() => setRenameForUser(null)} />
      )}
      {deleteForUser && (
        <DeletePermanentlyModal user={deleteForUser} onClose={() => setDeleteForUser(null)} />
      )}
    </section>
  );
}

// ----------------------- Row -------------------------------------------

interface UserRowProps {
  user: AdminUserRow;
  isCurrent: boolean;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onResetPassword: () => void;
  onChangeRole: () => void;
  onRenameUsername: () => void;
  onDeletePermanently: () => void;
}

function UserRowItem({
  user, isCurrent, menuOpen, onToggleMenu, onResetPassword, onChangeRole, onRenameUsername, onDeletePermanently,
}: UserRowProps) {
  const setStatus = useAdminSetStatus();

  const canDeactivate = !user.is_super_admin && !isCurrent;
  // 0043: same guards the server enforces — disable the menu item
  // upfront for a friendlier error path. Server is still the source of
  // truth (last-admin guard runs there).
  const canDelete = !user.is_super_admin && !isCurrent;

  const onToggleStatus = async () => {
    onToggleMenu(); // close menu
    const nextStatus = user.status === 'active' ? 'deactivated' : 'active';
    try {
      await setStatus.mutateAsync({ userId: user.id, status: nextStatus });
      toast.success(
        nextStatus === 'active'
          ? `${user.username} reactivated`
          : `${user.username} deactivated`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update status');
    }
  };

  return (
    <tr className={cn(
      'border-b border-border-light/60 last:border-b-0',
      user.status === 'deactivated' && 'opacity-60',
    )}>
      <td className="py-3 pr-3">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar name={user.full_name ?? user.username} url={user.avatar_url} size="md" />
          <div className="min-w-0">
            <p className="text-sm font-medium truncate flex items-center gap-1.5">
              {user.full_name ?? user.username}
              {user.is_super_admin && <Crown className="h-3.5 w-3.5 text-warning shrink-0" aria-label="Super admin" />}
              {isCurrent && (
                <span className="text-[10px] uppercase tracking-wide text-text-secondary font-semibold">(you)</span>
              )}
            </p>
            <p className="text-xs text-text-secondary truncate">@{user.username}</p>
          </div>
        </div>
      </td>
      <td className="py-3 pr-3">
        <RoleBadge role={user.role} />
      </td>
      <td className="py-3 pr-3">
        <span className={cn(
          'inline-flex items-center h-5 px-2 rounded-pill text-xs font-medium',
          user.status === 'active'
            ? 'bg-success/15 text-success'
            : 'bg-error/15 text-error',
        )}>
          {user.status === 'active' ? 'Active' : 'Deactivated'}
        </span>
      </td>
      <td className="py-3 pr-3 text-xs text-text-secondary">
        {user.last_active ? relativeDate(user.last_active) : '—'}
      </td>
      <td className="py-3 pr-1 text-right relative">
        <button
          type="button"
          aria-label="User menu"
          onClick={onToggleMenu}
          className="h-8 w-8 inline-flex items-center justify-center rounded-base text-text-secondary hover:bg-hover"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 top-10 w-48 z-30 bg-surface border border-border-light rounded-md shadow-lg overflow-hidden text-left"
            onMouseLeave={onToggleMenu}
          >
            <RowMenuItem icon={<AtSign className="h-4 w-4" />} label="Change username" onClick={onRenameUsername} />
            <RowMenuItem icon={<KeyRound className="h-4 w-4" />} label="Reset password" onClick={onResetPassword} />
            {user.username === 'teamblue' && <MarkTeamblueRotatedItem onDone={onToggleMenu} />}
            <RowMenuItem icon={<ShieldCheck className="h-4 w-4" />} label="Change role"
              onClick={onChangeRole}
              disabled={user.is_super_admin}
              disabledTitle="Super-admin role is fixed"
            />
            <RowMenuItem
              icon={user.status === 'active' ? <ShieldOff className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
              label={user.status === 'active' ? 'Deactivate' : 'Reactivate'}
              onClick={() => void onToggleStatus()}
              disabled={!canDeactivate}
              disabledTitle={
                user.is_super_admin
                  ? 'Cannot deactivate super-admin'
                  : isCurrent
                  ? 'Cannot deactivate yourself'
                  : undefined
              }
              destructive={user.status === 'active'}
            />
            <RowMenuItem
              icon={<Trash2 className="h-4 w-4" />}
              label="Delete permanently"
              onClick={onDeletePermanently}
              disabled={!canDelete}
              disabledTitle={
                user.is_super_admin
                  ? 'Cannot delete super-admin'
                  : isCurrent
                  ? 'Cannot delete yourself'
                  : undefined
              }
              destructive
            />
          </div>
        )}
      </td>
    </tr>
  );
}

function RowMenuItem({
  icon, label, onClick, disabled, disabledTitle, destructive,
}: {
  icon: React.ReactNode; label: string; onClick: () => void;
  disabled?: boolean; disabledTitle?: string; destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? disabledTitle : undefined}
      className={cn(
        'w-full px-3 py-2 text-sm flex items-center gap-2 hover:bg-hover',
        destructive && 'text-error hover:bg-error/10',
        disabled && 'opacity-40 cursor-not-allowed',
      )}
      role="menuitem"
    >
      <span className={cn(destructive ? 'text-error' : 'text-text-secondary')}>{icon}</span>
      {label}
    </button>
  );
}

/**
 * teamblue-only row action. Marks the latest backup-login event rotated
 * so the 72h chaser email stops. Additive — independent of the
 * password-reset flow (resetting the password and marking rotated are
 * intentionally decoupled so this never touches reset logic).
 */
function MarkTeamblueRotatedItem({ onDone }: { onDone: () => void }) {
  const mark = useMarkTeamblueRotated();
  return (
    <RowMenuItem
      icon={mark.isPending ? <Spinner className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
      label="Mark teamblue rotated"
      onClick={() => {
        if (mark.isPending) return;
        mark.mutate(undefined, {
          onSuccess: (did) => {
            toast.success(did ? 'Marked rotated — chaser suppressed' : 'No pending login to mark');
            onDone();
          },
          onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not mark rotated'),
        });
      }}
    />
  );
}

// ----------------------- Add user modal --------------------------------

function AddUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useAdminCreateUser();
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  // Per docs/PERMISSIONS-REDESIGN-PLAN.md: the two-role model. The
  // Add-User form only mints managers — admin is reserved for the
  // seeded super-admin and any later promotion via Change role.
  // (`setRole` kept so resetForm() can re-init the state.)
  const [role, setRole] = useState<'manager'>('manager');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Reset form when re-opened
  const resetForm = () => {
    setUsername(''); setFullName(''); setRole('manager'); setPassword(''); setShowPassword(false);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const u = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{2,32}$/.test(u)) {
      toast.error('Username must be 2-32 lowercase letters / digits / underscore');
      return;
    }
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    try {
      await create.mutateAsync({
        username: u,
        fullName: fullName.trim() || u,
        role,
        password,
      });
      toast.success(`Created @${u} — they can sign in now with this password`);
      resetForm();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create user');
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => { onClose(); resetForm(); }}
      title="Add user"
      size="md"
    >
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
        <FormField label="Username" hint={username ? `@${username.trim().toLowerCase()} → ${username.trim().toLowerCase() || 'user'}@pms.internal (internal only, never shown)` : '2-32 lowercase letters / digits / underscore'}>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            className="input"
            placeholder="e.g. pm4"
            required
          />
        </FormField>
        <FormField label="Full name">
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="input"
            placeholder="Optional — defaults to username"
          />
        </FormField>
        <FormField label="Role">
          {/* Two-role model: only Manager is mintable here. Admin is the
              seeded super-admin and is never created via this form. */}
          <div className="flex items-center gap-2">
            <RoleChoice value="manager" current={role} onSelect={setRole} label="Manager" description="Assigned board(s) only. Can change Status + post comments." />
          </div>
          <p className="text-xs text-text-secondary mt-1">
            New users can't be created as Admin. Promote them from the table afterwards.
          </p>
        </FormField>
        <FormField label="Initial password" hint="At least 8 characters. Share with the user privately.">
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input pr-10 font-mono"
              autoComplete="new-password"
              spellCheck={false}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              tabIndex={-1}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded-sm text-text-secondary hover:bg-hover"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </FormField>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button type="button" onClick={() => { onClose(); resetForm(); }} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" disabled={create.isPending} className="btn-primary inline-flex items-center gap-2">
            {create.isPending && <Spinner className="h-3 w-3" />}
            Create user
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RoleChoice({
  value, current, onSelect, label, description,
}: {
  value: 'manager'; current: 'manager';
  onSelect: (v: 'manager') => void;
  label: string; description: string;
}) {
  const active = value === current;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={cn(
        'flex-1 rounded-base border p-3 text-left transition-colors',
        active ? 'border-brand bg-brand/10' : 'border-border-light hover:bg-hover',
      )}
    >
      <p className={cn('text-sm font-semibold', active && 'text-brand')}>{label}</p>
      <p className="text-xs text-text-secondary mt-0.5">{description}</p>
    </button>
  );
}

// ----------------------- Reset password modal --------------------------

function ResetPasswordModal({ user, onClose }: { user: AdminUserRow; onClose: () => void }) {
  const reset = useAdminResetPassword();
  const [pw, setPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [show, setShow] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    if (pw !== confirmPw) { toast.error('Passwords do not match'); return; }
    try {
      await reset.mutateAsync({ userId: user.id, newPassword: pw });
      toast.success(`Password reset for @${user.username}. Share it privately.`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reset failed');
    }
  };

  return (
    <Modal open onClose={onClose} title={`Reset password — @${user.username}`} size="sm">
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
        <div className="bg-warning/10 border border-warning/30 rounded-base p-3 text-xs flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <p>
            The user's current password will be invalidated immediately. They'll need
            the new password on their next sign-in.
          </p>
        </div>
        <FormField label="New password" hint="At least 8 characters">
          <div className="relative">
            <input
              type={show ? 'text' : 'password'}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              className="input pr-10 font-mono"
              autoComplete="new-password"
              spellCheck={false}
              autoFocus
              required
            />
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShow((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded-sm text-text-secondary hover:bg-hover"
              aria-label={show ? 'Hide' : 'Show'}
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </FormField>
        <FormField label="Confirm new password">
          <input
            type={show ? 'text' : 'password'}
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            className="input font-mono"
            autoComplete="new-password"
            spellCheck={false}
            required
          />
        </FormField>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={reset.isPending} className="btn-primary inline-flex items-center gap-2">
            {reset.isPending && <Spinner className="h-3 w-3" />}
            Reset password
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ----------------------- Change role modal -----------------------------

function ChangeRoleModal({ user, onClose }: { user: AdminUserRow; onClose: () => void }) {
  const setRole = useAdminSetRole();
  const [role, setSel] = useState<UserRole>(user.role);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (role === user.role) { onClose(); return; }
    try {
      await setRole.mutateAsync({ userId: user.id, role });
      toast.success(`@${user.username} is now ${role}`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Role change failed');
    }
  };

  // Two-role model. Legacy 'viewer' users keep their role until promoted
  // — they're just not offered here.
  const ROLES: { value: UserRole; label: string; description: string }[] = [
    { value: 'admin',   label: 'Admin',   description: 'Full access — manage users, boards, everything.' },
    { value: 'manager', label: 'Manager', description: 'Assigned board(s) only. Status + comments.' },
  ];

  return (
    <Modal open onClose={onClose} title={`Change role — @${user.username}`} size="sm">
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-3">
        {ROLES.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => setSel(r.value)}
            className={cn(
              'w-full rounded-base border p-3 text-left transition-colors flex items-start gap-3',
              role === r.value ? 'border-brand bg-brand/10' : 'border-border-light hover:bg-hover',
            )}
          >
            <RoleBadge role={r.value} className="mt-0.5" />
            <div className="min-w-0">
              <p className={cn('text-sm font-semibold', role === r.value && 'text-brand')}>{r.label}</p>
              <p className="text-xs text-text-secondary mt-0.5">{r.description}</p>
            </div>
          </button>
        ))}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={setRole.isPending || role === user.role} className="btn-primary inline-flex items-center gap-2">
            {setRole.isPending && <Spinner className="h-3 w-3" />}
            Save role
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ----------------------- Rename username modal -------------------------

function RenameUsernameModal({ user, onClose }: { user: AdminUserRow; onClose: () => void }) {
  const rename = useAdminSetUsername();
  const [next, setNext] = useState(user.username);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = next.trim().toLowerCase();
    if (!/^[a-z0-9_]{2,32}$/.test(n)) {
      toast.error('Username must be 2-32 lowercase letters / digits / underscore');
      return;
    }
    if (n === user.username) { onClose(); return; }
    try {
      await rename.mutateAsync({ userId: user.id, newUsername: n });
      toast.success(`Renamed @${user.username} to @${n}`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rename failed');
    }
  };

  return (
    <Modal open onClose={onClose} title={`Change username — @${user.username}`} size="sm">
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
        <div className="bg-brand/10 border border-brand/30 rounded-base p-3 text-xs flex items-start gap-2">
          <AtSign className="h-4 w-4 text-brand shrink-0 mt-0.5" />
          <p>
            The user's login (email + password) is unaffected. They'll still be
            able to sign in by their email <em>and</em> by the new username.
          </p>
        </div>
        <FormField label="New username" hint="2-32 lowercase letters / digits / underscore">
          <input
            type="text"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            className="input"
            required
          />
        </FormField>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={rename.isPending} className="btn-primary inline-flex items-center gap-2">
            {rename.isPending && <Spinner className="h-3 w-3" />}
            Save username
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ----------------------- Delete permanently modal ----------------------

function DeletePermanentlyModal({ user, onClose }: { user: AdminUserRow; onClose: () => void }) {
  const del = useAdminDeleteUser();

  // One click on the red button is the confirm — no typing gate. The
  // server-side admin_delete_user RPC still enforces the real safety
  // (admin-only, self-delete, super-admin, last-admin); any blocked
  // case surfaces here as a toast.
  const onConfirm = async () => {
    try {
      await del.mutateAsync({ userId: user.id });
      toast.success(`@${user.username} deleted permanently`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  return (
    <Modal open onClose={onClose} title="Delete user" size="sm">
      <p className="text-sm text-text-primary">
        Delete <strong>@{user.username}</strong> permanently? This can't be undone.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={del.isPending}
          className="btn-secondary"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void onConfirm()}
          disabled={del.isPending}
          autoFocus
          className={cn(
            'h-9 px-3 rounded-base text-sm font-semibold inline-flex items-center gap-2 text-white transition-colors',
            del.isPending ? 'bg-error/60 cursor-wait' : 'bg-error hover:bg-error/90',
          )}
        >
          {del.isPending && <Spinner className="h-3 w-3" />}
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>
      </div>
    </Modal>
  );
}

// ----------------------- Helpers ---------------------------------------

function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wide text-text-secondary font-medium mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-text-secondary mt-1">{hint}</span>}
    </label>
  );
}

function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}
