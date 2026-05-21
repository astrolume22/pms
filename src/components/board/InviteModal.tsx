/**
 * Phase 6.5 — Invite link modal opened from BoardHeader's Invite button.
 *
 * Admin / board-owner / manager picks a role + expiry and clicks
 * "Generate invite link". The token is rendered into a fixed URL like
 *   {origin}/invite/{token}
 * which the admin can copy to clipboard and paste into WhatsApp etc.
 *
 * The modal also lists existing invites for this board so the admin can
 * see what's outstanding and revoke entries before they're used.
 *
 * We surface three role options in the UI (Manager / Editor / Viewer).
 * Until we have a dedicated `editor` role, the Editor option maps to
 * `role='manager'` — same global permissions, but on a board-scoped
 * invite they're added as a board subscriber, not as a workspace
 * admin. (Manager / Viewer also work on workspace-wide invites.)
 */
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Link2, Copy, Check, Trash2, Globe, Lock,
} from 'lucide-react';
import { Modal } from '@/components/Modal';
import { RoleBadge } from '@/components/RoleBadge';
import { Spinner } from '@/components/Spinner';
import { EmptyMessage } from '@/components/EmptyMessage';
import {
  useInvitesForBoard, useCreateInvite, useRevokeInvite,
  type InviteRow,
} from '@/hooks/invites';
import type { UserRole } from '@/lib/database.types';
import { cn } from '@/lib/cn';

type UiRole = 'manager' | 'editor' | 'viewer';
const UI_ROLE_TO_DB: Record<UiRole, UserRole> = {
  manager: 'manager',
  editor: 'manager',  // mapped — we don't have a separate 'editor' role
  viewer: 'viewer',
};

interface InviteModalProps {
  open: boolean;
  onClose: () => void;
  boardId: string;
  boardName: string;
}

export function InviteModal({ open, onClose, boardId, boardName }: InviteModalProps) {
  const [uiRole, setUiRole] = useState<UiRole>('manager');
  const [scope, setScope] = useState<'board' | 'workspace'>('board');
  const [expires, setExpires] = useState<24 | 168 | 720>(168);
  const [newLink, setNewLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const list = useInvitesForBoard(scope === 'workspace' ? null : boardId);
  const create = useCreateInvite();
  const revoke = useRevokeInvite();

  const onGenerate = async () => {
    try {
      const data = await create.mutateAsync({
        role: UI_ROLE_TO_DB[uiRole],
        boardId: scope === 'workspace' ? null : boardId,
        expiresInHours: expires,
      });
      const link = `${window.location.origin}/invite/${data.token}`;
      setNewLink(link);
      setCopied(false);
      toast.success('Invite link ready');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not generate invite');
    }
  };

  const onCopy = async () => {
    if (!newLink) return;
    try {
      await navigator.clipboard.writeText(newLink);
      setCopied(true);
      toast.success('Link copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Copy failed — select and copy manually');
    }
  };

  // Reset transient state when modal re-opens
  const handleClose = () => {
    setNewLink(null);
    setCopied(false);
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title={`Invite people — ${boardName}`} size="md">
      <div className="space-y-5">
        {/* Role chooser */}
        <Section label="Role">
          <div className="grid grid-cols-3 gap-2">
            <RoleChoice
              value="manager"
              current={uiRole}
              onSelect={setUiRole}
              label="Manager"
              description="Workspace-wide manager."
            />
            <RoleChoice
              value="editor"
              current={uiRole}
              onSelect={setUiRole}
              label="Editor"
              description="Manager-level edit on this board."
            />
            <RoleChoice
              value="viewer"
              current={uiRole}
              onSelect={setUiRole}
              label="Viewer"
              description="Read-only on assigned boards."
            />
          </div>
        </Section>

        {/* Scope (board vs workspace) */}
        <Section label="Scope">
          <div className="flex items-center gap-2">
            <ScopeChoice
              value="board"
              current={scope}
              onSelect={setScope}
              icon={<Lock className="h-4 w-4" />}
              label="This board"
              hint={boardName}
            />
            <ScopeChoice
              value="workspace"
              current={scope}
              onSelect={setScope}
              icon={<Globe className="h-4 w-4" />}
              label="Whole workspace"
              hint="Joins main workspace"
            />
          </div>
        </Section>

        {/* Expires */}
        <Section label="Expires after">
          <div className="flex items-center gap-2">
            <ExpiresChoice value={24}  current={expires} onSelect={setExpires} label="24 hours" />
            <ExpiresChoice value={168} current={expires} onSelect={setExpires} label="7 days" />
            <ExpiresChoice value={720} current={expires} onSelect={setExpires} label="30 days" />
          </div>
        </Section>

        {/* Generate / copy row */}
        <div>
          {!newLink ? (
            <button
              type="button"
              onClick={() => void onGenerate()}
              disabled={create.isPending}
              className="btn-primary w-full inline-flex items-center justify-center gap-2"
            >
              {create.isPending && <Spinner className="h-3 w-3" />}
              <Link2 className="h-4 w-4" />
              Generate invite link
            </button>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={newLink}
                  className="input flex-1 font-mono text-[12px]"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  type="button"
                  onClick={() => void onCopy()}
                  className={cn('btn-primary h-9 px-3 inline-flex items-center gap-1.5', copied && 'bg-success hover:bg-success')}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="text-xs text-text-secondary">
                Anyone with this link can claim a {UI_ROLE_TO_DB[uiRole]} account
                {scope === 'workspace' ? '' : ' subscribed to this board'}.
                Share it on WhatsApp / Signal / etc. — it's single-use and
                expires in {expires === 24 ? '24 hours' : expires === 168 ? '7 days' : '30 days'}.
              </p>
              <button
                type="button"
                onClick={() => setNewLink(null)}
                className="btn-ghost h-8 text-xs"
              >
                Generate another
              </button>
            </div>
          )}
        </div>

        {/* Outstanding invites */}
        <div className="pt-4 border-t border-border-light">
          <h3 className="text-sm font-semibold mb-2">Outstanding invites</h3>
          {list.isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Spinner className="h-5 w-5 text-brand" />
            </div>
          ) : !list.data || list.data.length === 0 ? (
            <EmptyMessage
              title="No invites yet"
              description="Generated links will show here so you can revoke or re-share them."
            />
          ) : (
            <ul className="space-y-2 max-h-[240px] overflow-y-auto">
              {list.data.map((inv) => (
                <InviteListItem
                  key={inv.id}
                  invite={inv}
                  onRevoke={async () => {
                    if (!window.confirm('Revoke this invite? The link will stop working immediately.')) return;
                    try {
                      await revoke.mutateAsync({ id: inv.id, boardId: scope === 'workspace' ? null : boardId });
                      toast.success('Invite revoked');
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'Revoke failed');
                    }
                  }}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
function InviteListItem({ invite, onRevoke }: { invite: InviteRow; onRevoke: () => void }) {
  const state = useMemo(() => deriveState(invite), [invite]);
  return (
    <li className="flex items-center gap-3 border border-border-light rounded-base p-2.5 bg-app/30">
      <RoleBadge role={invite.role} />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-text-secondary truncate">
          {state.label} · expires {new Date(invite.expires_at).toLocaleDateString()}
        </p>
        <p className="text-[11px] text-text-disabled font-mono truncate">
          {invite.token}
        </p>
      </div>
      <span className={cn(
        'inline-flex items-center h-5 px-2 rounded-pill text-[10px] uppercase tracking-wide font-medium',
        state.kind === 'active'   && 'bg-success/15 text-success',
        state.kind === 'used'     && 'bg-text-secondary/15 text-text-secondary',
        state.kind === 'expired'  && 'bg-warning/15 text-warning',
        state.kind === 'revoked'  && 'bg-error/15 text-error',
      )}>
        {state.kind}
      </span>
      {state.kind === 'active' && (
        <button
          type="button"
          onClick={onRevoke}
          aria-label="Revoke"
          title="Revoke"
          className="h-7 w-7 inline-flex items-center justify-center rounded-base text-error hover:bg-error/10"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );
}

function deriveState(inv: InviteRow): { kind: 'active' | 'used' | 'expired' | 'revoked'; label: string } {
  if (inv.revoked_at) return { kind: 'revoked', label: 'Revoked' };
  if (inv.used_at)    return { kind: 'used',    label: `Used ${new Date(inv.used_at).toLocaleDateString()}` };
  if (new Date(inv.expires_at) <= new Date()) return { kind: 'expired', label: 'Expired' };
  return { kind: 'active', label: 'Active' };
}

// ---------------------------------------------------------------------
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="text-xs uppercase tracking-wide text-text-secondary font-medium mb-1.5">{label}</p>
      {children}
    </section>
  );
}

function RoleChoice<T extends string>({
  value, current, onSelect, label, description,
}: {
  value: T; current: T; onSelect: (v: T) => void;
  label: string; description: string;
}) {
  const active = value === current;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={cn(
        'rounded-base border p-2.5 text-left transition-colors',
        active ? 'border-brand bg-brand/10' : 'border-border-light hover:bg-hover',
      )}
    >
      <p className={cn('text-sm font-semibold', active && 'text-brand')}>{label}</p>
      <p className="text-[11px] text-text-secondary mt-0.5 leading-snug">{description}</p>
    </button>
  );
}

function ScopeChoice<T extends string>({
  value, current, onSelect, icon, label, hint,
}: {
  value: T; current: T; onSelect: (v: T) => void;
  icon: React.ReactNode; label: string; hint: string;
}) {
  const active = value === current;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={cn(
        'flex-1 rounded-base border p-2.5 text-left transition-colors flex items-center gap-2',
        active ? 'border-brand bg-brand/10' : 'border-border-light hover:bg-hover',
      )}
    >
      <span className={active ? 'text-brand' : 'text-text-secondary'}>{icon}</span>
      <div className="min-w-0">
        <p className={cn('text-sm font-medium', active && 'text-brand')}>{label}</p>
        <p className="text-[11px] text-text-secondary truncate">{hint}</p>
      </div>
    </button>
  );
}

function ExpiresChoice<T extends number>({
  value, current, onSelect, label,
}: { value: T; current: T; onSelect: (v: T) => void; label: string }) {
  const active = value === current;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={cn(
        'flex-1 h-9 rounded-base border text-sm font-medium transition-colors',
        active ? 'border-brand bg-brand/10 text-brand' : 'border-border-light hover:bg-hover text-text-secondary',
      )}
    >
      {label}
    </button>
  );
}
