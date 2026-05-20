import { useRef, useState } from 'react';
import { Smile, MoreHorizontal, Pencil, Trash2, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import {
  useItemUpdates, useCreateUpdate, useDeleteUpdate, useEditUpdate, useToggleReaction,
  type UpdateWithMeta,
} from '@/hooks/updates';
import { useAuthStore } from '@/state/authStore';
import { useActiveUsers } from '@/hooks/users';
import { RichTextEditor, type RichTextEditorHandle } from './RichTextEditor';
import { Avatar } from '@/components/Avatar';
import { Spinner } from '@/components/Spinner';
import { EmptyMessage } from '@/components/EmptyMessage';
import { cn } from '@/lib/cn';

const QUICK_EMOJIS = ['👍', '❤️', '😄', '🎉', '🚀', '👀'];

export function UpdatesTab({ itemId, canEdit }: { itemId: string; canEdit: boolean }) {
  const profile = useAuthStore((s) => s.profile);
  const { data: updates, isLoading } = useItemUpdates(itemId);
  const create = useCreateUpdate();
  const editorRef = useRef<RichTextEditorHandle>(null);

  const onSubmit = async () => {
    if (!editorRef.current) return;
    const html = editorRef.current.getHtml().trim();
    // Tiptap leaves <p></p> for empty content — treat that as empty.
    const stripped = html.replace(/<p[^>]*>(?:\s|&nbsp;)*<\/p>/gi, '').trim();
    if (!stripped) {
      toast.error('Write something first');
      return;
    }
    const json = editorRef.current.getJson();
    const mentions = editorRef.current.getMentionedUserIds();
    try {
      await create.mutateAsync({ itemId, bodyHtml: html, bodyJson: json, mentionedUserIds: mentions });
      editorRef.current.clear();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to post update');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {canEdit && (
        <div>
          <RichTextEditor
            ref={editorRef}
            placeholder="Write an update... Use @ to mention someone"
            minHeightPx={88}
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => editorRef.current?.clear()}
              className="btn-ghost h-8 text-xs"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => void onSubmit()}
              disabled={create.isPending}
              className="btn-primary h-8 text-xs"
            >
              {create.isPending && <Spinner className="h-3 w-3 mr-2" />}
              Update
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Spinner className="h-5 w-5 text-brand" />
        </div>
      ) : !updates || updates.length === 0 ? (
        <EmptyMessage
          title="No updates yet"
          description="Start the conversation by posting an update above."
          icon={<MessageSquare className="h-6 w-6" />}
        />
      ) : (
        <ul className="space-y-3">
          {updates.map((u) => (
            <UpdateItem
              key={u.id}
              update={u}
              itemId={itemId}
              isOwn={u.author_id === profile?.id}
              canModerate={!!profile && (profile.role === 'admin' || profile.is_super_admin)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function UpdateItem({
  update, itemId, isOwn, canModerate,
}: { update: UpdateWithMeta; itemId: string; isOwn: boolean; canModerate: boolean }) {
  const profile = useAuthStore((s) => s.profile);
  const { data: users } = useActiveUsers();
  const author = users?.find((u) => u.id === update.author_id);

  const edit = useEditUpdate();
  const del = useDeleteUpdate();
  const toggleReaction = useToggleReaction();
  const editorRef = useRef<RichTextEditorHandle>(null);

  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Aggregate reactions by emoji
  const reactionsByEmoji = new Map<string, { users: string[] }>();
  for (const r of update.reactions) {
    const entry = reactionsByEmoji.get(r.emoji) ?? { users: [] };
    entry.users.push(r.user_id);
    reactionsByEmoji.set(r.emoji, entry);
  }

  const onToggle = (emoji: string) => {
    if (!profile) return;
    const on = reactionsByEmoji.get(emoji)?.users.includes(profile.id) ?? false;
    void toggleReaction.mutateAsync({ updateId: update.id, emoji, itemId, currentlyOn: on });
  };

  const onSaveEdit = async () => {
    if (!editorRef.current) return;
    const html = editorRef.current.getHtml();
    const json = editorRef.current.getJson();
    try {
      await edit.mutateAsync({ id: update.id, itemId, bodyHtml: html, bodyJson: json });
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Edit failed');
    }
  };

  return (
    <li className="bg-surface border border-border-light rounded-md p-3">
      <header className="flex items-center gap-2 mb-2">
        <Avatar name={author?.full_name ?? author?.username ?? '?'} url={author?.avatar_url} size="sm" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-tight truncate">
            {author?.full_name ?? author?.username ?? 'Unknown'}
          </p>
          <p className="text-[11px] text-text-secondary truncate">
            @{author?.username ?? '—'} · {relativeTime(update.created_at)}
            {update.edited_at && <span className="ml-1 text-text-disabled">(edited)</span>}
          </p>
        </div>
        {(isOwn || canModerate) && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Update menu"
              className="h-6 w-6 inline-flex items-center justify-center rounded-sm text-text-secondary hover:bg-hover"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 top-7 z-10 w-36 bg-surface border border-border-light rounded-md shadow-lg overflow-hidden"
                onMouseLeave={() => setMenuOpen(false)}
              >
                {isOwn && (
                  <button
                    onClick={() => { setMenuOpen(false); setEditing(true); }}
                    className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-hover"
                  >
                    <Pencil className="h-3.5 w-3.5 text-text-secondary" /> Edit
                  </button>
                )}
                <button
                  onClick={async () => {
                    setMenuOpen(false);
                    if (!window.confirm('Delete this update?')) return;
                    try {
                      await del.mutateAsync({ id: update.id, itemId });
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'Delete failed');
                    }
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-error/10 text-error"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </button>
              </div>
            )}
          </div>
        )}
      </header>

      {editing ? (
        <>
          <RichTextEditor ref={editorRef} initialHtml={update.body_html} minHeightPx={64} />
          <div className="mt-2 flex justify-end gap-1">
            <button onClick={() => setEditing(false)} className="btn-ghost h-7 px-2 text-xs">Cancel</button>
            <button onClick={() => void onSaveEdit()} className="btn-primary h-7 px-3 text-xs">Save</button>
          </div>
        </>
      ) : (
        <div
          className="text-sm leading-relaxed"
          dangerouslySetInnerHTML={{ __html: update.body_html }}
        />
      )}

      {/* Reactions */}
      <div className="mt-2 flex items-center gap-1 flex-wrap">
        {Array.from(reactionsByEmoji.entries()).map(([emoji, info]) => {
          const isOn = profile && info.users.includes(profile.id);
          return (
            <button
              key={emoji}
              type="button"
              onClick={() => onToggle(emoji)}
              className={cn(
                'inline-flex items-center gap-1 h-6 px-2 rounded-pill border text-xs',
                isOn ? 'bg-selected border-brand text-brand' : 'bg-app border-border-light text-text-secondary hover:bg-hover',
              )}
            >
              <span>{emoji}</span>
              <span>{info.users.length}</span>
            </button>
          );
        })}
        <div className="relative">
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            aria-label="React"
            className="h-6 w-6 inline-flex items-center justify-center rounded-pill border border-border-light bg-app text-text-secondary hover:bg-hover"
          >
            <Smile className="h-3 w-3" />
          </button>
          {pickerOpen && (
            <div
              className="absolute left-0 bottom-7 z-10 bg-surface border border-border-light rounded-md shadow-lg px-1 py-1 flex gap-1"
              onMouseLeave={() => setPickerOpen(false)}
            >
              {QUICK_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => { setPickerOpen(false); onToggle(e); }}
                  className="h-7 w-7 inline-flex items-center justify-center rounded-sm hover:bg-hover text-sm"
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function relativeTime(iso: string): string {
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
