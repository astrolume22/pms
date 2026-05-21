/**
 * Tiptap-based rich text composer with @mentions.
 *
 * Out: { html, json, mentionedUserIds }
 *
 * We render the mention popover manually (no tippy.js dependency) — Tiptap
 * Suggestion gives us a clientRect callback we feed into a fixed-position div.
 */
import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import { useEditor, EditorContent, ReactRenderer } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Mention from '@tiptap/extension-mention';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, Link as LinkIcon, List, ListOrdered,
  Type, Palette, Minus, AlignLeft, Table as TableIcon, CheckSquare, Pilcrow,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useActiveUsers } from '@/hooks/users';
import { MentionList, type MentionListHandle } from './MentionList';

export interface RichTextEditorHandle {
  getHtml: () => string;
  getJson: () => unknown;
  getMentionedUserIds: () => string[];
  clear: () => void;
  focus: () => void;
}

interface RichTextEditorProps {
  initialHtml?: string;
  initialJson?: unknown;
  placeholder?: string;
  minHeightPx?: number;
  className?: string;
  showToolbar?: boolean;
}

export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(
  ({ initialHtml, initialJson, placeholder, minHeightPx = 80, className, showToolbar = true }, ref) => {
    const { data: users } = useActiveUsers();
    const usersRef = useRef(users ?? []);
    useEffect(() => { usersRef.current = users ?? []; }, [users]);

    // Track suggestion popover position + state
    const [popover, setPopover] = useState<{
      items: ReturnType<typeof toMentionItems>;
      clientRect: { top: number; left: number; height: number } | null;
      command: ((it: { id: string; label: string }) => void) | null;
    } | null>(null);
    const listRef = useRef<MentionListHandle | null>(null);
    const componentRef = useRef<ReactRenderer<MentionListHandle, { items: ReturnType<typeof toMentionItems>; command: (i: { id: string; label: string }) => void }> | null>(null);

    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          heading: false,
          codeBlock: false,
          blockquote: false,
          horizontalRule: false,
        }),
        Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { class: 'text-brand underline' } }),
        Placeholder.configure({ placeholder: placeholder ?? 'Write an update...' }),
        Mention.extend({
          // Persist the mentioned userId in our HTML so the server-side
          // notification trigger has something to pick up.
          addAttributes() {
            return {
              id: { default: null, parseHTML: (e) => e.getAttribute('data-id'), renderHTML: (a) => ({ 'data-id': a.id }) },
              label: { default: null, parseHTML: (e) => e.getAttribute('data-label'), renderHTML: (a) => ({ 'data-label': a.label }) },
            };
          },
        }).configure({
          HTMLAttributes: {
            class:
              'inline-flex items-center px-1.5 h-5 rounded-sm text-xs font-medium bg-brand/10 text-brand',
          },
          renderHTML({ options, node }) {
            return [
              'span',
              { ...options.HTMLAttributes, 'data-id': node.attrs.id, 'data-label': node.attrs.label },
              `@${node.attrs.label}`,
            ];
          },
          suggestion: {
            char: '@',
            items: ({ query }) => {
              return toMentionItems(usersRef.current, query).slice(0, 8);
            },
            render: () => {
              return {
                onStart: (props) => {
                  setPopover({
                    items: props.items,
                    clientRect: rectFromProps(props.clientRect ?? null),
                    command: (it) => (props.command as (i: { id: string; label: string }) => void)(it),
                  });
                  componentRef.current = new ReactRenderer(MentionList, {
                    props: { items: props.items, command: props.command as (i: { id: string; label: string }) => void },
                    editor: props.editor,
                  });
                  // The ReactRenderer .ref forwards to MentionListHandle once mounted.
                  listRef.current = componentRef.current.ref as MentionListHandle | null;
                },
                onUpdate: (props) => {
                  setPopover({
                    items: props.items,
                    clientRect: rectFromProps(props.clientRect ?? null),
                    command: (it) => (props.command as (i: { id: string; label: string }) => void)(it),
                  });
                  componentRef.current?.updateProps({ items: props.items, command: props.command as (i: { id: string; label: string }) => void });
                },
                onKeyDown: (props) => {
                  if (props.event.key === 'Escape') { setPopover(null); return true; }
                  return listRef.current?.onKeyDown(props.event) ?? false;
                },
                onExit: () => {
                  setPopover(null);
                  componentRef.current?.destroy();
                  componentRef.current = null;
                  listRef.current = null;
                },
              };
            },
          },
        }),
      ],
      content: initialJson ?? initialHtml ?? '',
      editorProps: {
        attributes: {
          class: cn(
            'prose-sm max-w-none px-3 py-2 outline-none text-sm leading-relaxed',
            'min-h-[var(--min-h)]',
          ),
          style: `--min-h:${minHeightPx}px`,
        },
      },
    });

    useImperativeHandle(ref, () => ({
      getHtml: () => editor?.getHTML() ?? '',
      getJson: () => editor?.getJSON() ?? null,
      getMentionedUserIds: () => collectMentions(editor),
      clear: () => editor?.commands.clearContent(true),
      focus: () => editor?.commands.focus(),
    }), [editor]);

    return (
      <div className={cn('relative border border-border-medium rounded-base bg-surface focus-within:border-brand transition-colors', className)}>
        {showToolbar && editor && <Toolbar editor={editor} />}
        <EditorContent editor={editor} />
        {popover && popover.clientRect && popover.command && (
          <div
            className="fixed z-50"
            style={{
              top: popover.clientRect.top + popover.clientRect.height + 4,
              left: popover.clientRect.left,
            }}
          >
            <MentionList ref={listRef} items={popover.items} command={popover.command} />
          </div>
        )}
      </div>
    );
  },
);

RichTextEditor.displayName = 'RichTextEditor';

function rectFromProps(getRect: (() => DOMRect | null) | null): { top: number; left: number; height: number } | null {
  if (!getRect) return null;
  const r = getRect();
  if (!r) return null;
  return { top: r.top, left: r.left, height: r.height };
}

function toMentionItems(users: ReadonlyArray<{ id: string; username: string; full_name: string | null; avatar_url: string | null }>, query: string) {
  const needle = query.toLowerCase();
  return users
    .filter((u) =>
      !needle
      || u.username.toLowerCase().includes(needle)
      || (u.full_name?.toLowerCase().includes(needle) ?? false),
    )
    .map((u) => ({ id: u.id, label: u.full_name ?? u.username, username: u.username, avatar_url: u.avatar_url }));
}

function collectMentions(editor: Editor | null): string[] {
  if (!editor) return [];
  const ids = new Set<string>();
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'mention' && node.attrs.id) ids.add(node.attrs.id as string);
  });
  return Array.from(ids);
}

function Toolbar({ editor }: { editor: Editor }) {
  const setLink = () => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('URL', prev ?? 'https://');
    if (url === null) return;
    if (!url) { editor.chain().focus().unsetLink().run(); return; }
    const final = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    editor.chain().focus().extendMarkRange('link').setLink({ href: final }).run();
  };

  return (
    <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border-light overflow-x-auto">
      {/* Heading / paragraph style — disabled placeholder for Monday parity */}
      <TBtn disabled icon={<Pilcrow className="h-4 w-4" />} label="Paragraph" />
      <TBtn active={editor.isActive('bold')}    onClick={() => editor.chain().focus().toggleBold().run()}   icon={<Bold className="h-4 w-4" />}        label="Bold" />
      <TBtn active={editor.isActive('italic')}  onClick={() => editor.chain().focus().toggleItalic().run()} icon={<Italic className="h-4 w-4" />}      label="Italic" />
      <TBtn disabled icon={<UnderlineIcon className="h-4 w-4" />} label="Underline (Phase 6)" />
      <TBtn active={editor.isActive('strike')}  onClick={() => editor.chain().focus().toggleStrike().run()} icon={<Strikethrough className="h-4 w-4" />} label="Strikethrough" />
      <TBtn disabled icon={<Palette className="h-4 w-4" />} label="Text color (Phase 6)" />
      <TBtn disabled icon={<Type className="h-4 w-4" />} label="Font size (Phase 6)" />
      <div className="h-4 w-px bg-border-light mx-1" />
      <TBtn active={editor.isActive('bulletList')}  onClick={() => editor.chain().focus().toggleBulletList().run()}  icon={<List className="h-4 w-4" />}        label="Bulleted list" />
      <TBtn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} icon={<ListOrdered className="h-4 w-4" />} label="Numbered list" />
      <TBtn disabled icon={<TableIcon className="h-4 w-4" />} label="Table (Phase 6)" />
      <TBtn active={editor.isActive('link')} onClick={setLink} icon={<LinkIcon className="h-4 w-4" />} label="Link" />
      <TBtn disabled icon={<AlignLeft className="h-4 w-4" />} label="Align (Phase 6)" />
      <TBtn disabled icon={<Minus className="h-4 w-4" />} label="Divider (Phase 6)" />
      <TBtn disabled icon={<CheckSquare className="h-4 w-4" />} label="Checklist (Phase 6)" />
    </div>
  );
}

function TBtn({ icon, label, onClick, active, disabled }: { icon: React.ReactNode; label: string; onClick?: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        'h-7 w-7 inline-flex items-center justify-center rounded-sm shrink-0',
        active ? 'bg-selected text-brand' : 'text-text-secondary hover:bg-hover',
        disabled && 'opacity-40 cursor-not-allowed',
      )}
    >
      {icon}
    </button>
  );
}
