/**
 * Phase 3 Step 3 — Admin "Group access" matrix.
 *
 * Pick a board → pick a user → toggle which groups that user can see.
 * Master admins (role='admin' or is_super_admin) bypass the ACL in RLS,
 * so for them the matrix is a read-only "sees all groups" note.
 *
 * Writes are single-row by composite PK and gated by guv_write RLS
 * (admin-only). Optimistic-ish: the UI invalidates on success which
 * refetches immediately — TanStack's per-mutation onError + toast
 * surface failures without leaving the UI in a lie.
 */
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ShieldCheck, Crown } from 'lucide-react';
import { useAuthStore } from '@/state/authStore';
import { useBoards } from '@/hooks/boards';
import { useAdminUsers } from '@/hooks/admin';
import {
  useBoardGroups,
  useUserGroupVisibility,
  useGrantGroupAccess,
  useRevokeGroupAccess,
} from '@/hooks/groupAccess';
import { Spinner } from '@/components/Spinner';
import { RoleBadge } from '@/components/RoleBadge';

const TESSERA_BOARD_ID = '28472783-6d7a-4de9-8834-2354f62856c5';

export function GroupAccessSection() {
  const profile     = useAuthStore((s) => s.profile);
  const { data: boards }   = useBoards();
  const { data: users }    = useAdminUsers();

  // Default: Tessera (the headline board) if present in the user's
  // board list, otherwise the first alphabetical board.
  const [boardId, setBoardId] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (boardId || !boards || boards.length === 0) return;
    const tess = boards.find((b) => b.id === TESSERA_BOARD_ID);
    setBoardId((tess ?? boards[0]).id);
  }, [boards, boardId]);

  // Default user: the first non-admin, otherwise the first user.
  const [userId, setUserId] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (userId || !users || users.length === 0) return;
    const nonAdmin = users.find((u) => u.role !== 'admin' && !u.is_super_admin && u.status === 'active');
    setUserId((nonAdmin ?? users[0]).id);
  }, [users, userId]);

  const { data: groups,  isLoading: groupsLoading }  = useBoardGroups(boardId);
  const { data: grantSet, isLoading: grantsLoading } = useUserGroupVisibility(userId, boardId);
  const grant  = useGrantGroupAccess();
  const revoke = useRevokeGroupAccess();

  const selectedUser = useMemo(
    () => users?.find((u) => u.id === userId),
    [users, userId]
  );
  const userIsAdmin = !!selectedUser && (selectedUser.role === 'admin' || selectedUser.is_super_admin);

  const toggle = async (groupId: string, currentlyGranted: boolean) => {
    if (!userId || !profile?.id) return;
    try {
      if (currentlyGranted) {
        await revoke.mutateAsync({ userId, groupId });
      } else {
        await grant.mutateAsync({ userId, groupId, grantedBy: profile.id });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update access';
      toast.error(msg);
    }
  };

  return (
    <section className="bg-surface border border-border-light rounded-md p-6">
      <header className="mb-4">
        <h2 className="text-lg font-semibold">Group access</h2>
        <p className="text-sm text-text-secondary">
          Choose which groups each user can see. Unchecked groups are hidden from that user.
          Master admins always see everything.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        <label className="block">
          <span className="text-[12px] font-semibold uppercase tracking-wide text-text-secondary">Board</span>
          <select
            value={boardId ?? ''}
            onChange={(e) => setBoardId(e.target.value || undefined)}
            disabled={!boards || boards.length === 0}
            className="mt-1 w-full h-10 px-3 rounded-base bg-canvas border border-border-light text-text-primary"
          >
            {(boards ?? []).map((b) => (
              <option key={b.id} value={b.id}>{b.icon_emoji ? `${b.icon_emoji} ` : ''}{b.name}</option>
            ))}
            {(!boards || boards.length === 0) && <option value="">No boards available</option>}
          </select>
        </label>

        <label className="block">
          <span className="text-[12px] font-semibold uppercase tracking-wide text-text-secondary">User</span>
          <select
            value={userId ?? ''}
            onChange={(e) => setUserId(e.target.value || undefined)}
            disabled={!users || users.length === 0}
            className="mt-1 w-full h-10 px-3 rounded-base bg-canvas border border-border-light text-text-primary"
          >
            {(users ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name ?? u.username} ({u.role}{u.is_super_admin ? ', super' : ''}{u.status !== 'active' ? `, ${u.status}` : ''})
              </option>
            ))}
            {(!users || users.length === 0) && <option value="">No users available</option>}
          </select>
        </label>
      </div>

      {/* Body */}
      {!boardId || !userId ? (
        <p className="text-sm text-text-secondary">Pick a board and a user above.</p>
      ) : userIsAdmin ? (
        <div className="flex items-center gap-3 px-4 py-3 rounded-base bg-canvas border border-border-light text-sm text-text-secondary">
          <Crown className="h-4 w-4 text-amber-400" />
          <span>
            <strong className="text-text-primary">{selectedUser?.full_name ?? selectedUser?.username}</strong>
            {' '}is a master admin and sees all groups on every board. Access cannot be revoked here.
          </span>
        </div>
      ) : groupsLoading || grantsLoading ? (
        <div className="flex items-center justify-center py-12"><Spinner className="h-6 w-6 text-brand" /></div>
      ) : !groups || groups.length === 0 ? (
        <p className="text-sm text-text-secondary">This board has no groups yet.</p>
      ) : (
        <div className="space-y-1">
          <div className="flex items-center gap-2 mb-2 text-[12px] text-text-secondary">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>
              <RoleBadge role={selectedUser!.role} />{' '}
              currently sees {grantSet?.size ?? 0} of {groups.length} groups.
            </span>
          </div>
          <ul className="divide-y divide-border-hair">
            {groups.map((g) => {
              const has = grantSet?.has(g.id) ?? false;
              const pending = grant.isPending || revoke.isPending;
              return (
                <li key={g.id} className="flex items-center gap-3 py-2">
                  <input
                    type="checkbox"
                    checked={has}
                    disabled={pending}
                    onChange={() => void toggle(g.id, has)}
                    className="h-4 w-4 accent-brand cursor-pointer"
                    id={`guv-${g.id}`}
                  />
                  <span
                    aria-hidden
                    className="h-3 w-3 rounded-full shrink-0"
                    style={{ background: g.color }}
                  />
                  <label htmlFor={`guv-${g.id}`} className="text-sm text-text-primary cursor-pointer flex-1">
                    {g.name}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
