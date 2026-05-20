/**
 * AI side panel. Triggered from the ✨ button in the board header.
 * Three modes:
 *   • Create Board   — admin/manager only; prompt → server creates a
 *                      new board with default groups/columns/tasks
 *   • Create Tasks   — adds tasks to the current board
 *   • Chat           — Q&A over the current board's state
 *
 * If no Gemini key is configured, every mode shows the same "not
 * configured" message with a link to the admin panel.
 */
import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Sparkles, X, Send, Loader2, Plus, MessageSquare, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { useGeminiInvoke, useGeminiStatus } from '@/hooks/gemini';
import { useBoardItems, useCreateItem } from '@/hooks/items';
import { useColumns } from '@/hooks/columns';
import { useGroups } from '@/hooks/groups';
import { useCreateBoard } from '@/hooks/boards';
import { useAuthStore } from '@/state/authStore';
import type { BoardWithOwner } from '@/hooks/boards';
import { cn } from '@/lib/cn';

type Mode = 'chat' | 'create_tasks' | 'create_board';

interface AiPanelProps {
  open: boolean;
  onClose: () => void;
  board: BoardWithOwner;
}

export function AiPanel({ open, onClose, board }: AiPanelProps) {
  const profile = useAuthStore((s) => s.profile);
  const canCreateBoard = !!profile && (profile.role === 'admin' || profile.role === 'manager');
  const [mode, setMode] = useState<Mode>('chat');

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-label="AI Sidekick"
        className="w-full max-w-[480px] bg-surface text-text-primary shadow-xl flex flex-col task-panel-enter"
      >
        <header className="flex items-center gap-2 px-4 py-3 border-b border-border-light bg-app/30">
          <Sparkles className="h-5 w-5 text-brand" />
          <h2 className="text-lg font-semibold flex-1">AI Sidekick</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="h-7 w-7 inline-flex items-center justify-center rounded-sm text-text-secondary hover:bg-hover"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <nav className="flex items-center gap-1 px-2 pt-2 border-b border-border-light bg-surface">
          <ModeTab active={mode === 'chat'}         onClick={() => setMode('chat')}         icon={<MessageSquare className="h-3.5 w-3.5" />} label="Chat" />
          <ModeTab active={mode === 'create_tasks'} onClick={() => setMode('create_tasks')} icon={<Plus className="h-3.5 w-3.5" />}          label="Create tasks" />
          {canCreateBoard && (
            <ModeTab active={mode === 'create_board'} onClick={() => setMode('create_board')} icon={<Wand2 className="h-3.5 w-3.5" />} label="Create board" />
          )}
        </nav>

        <div className="flex-1 overflow-y-auto p-4">
          {mode === 'chat'         && <ChatMode board={board} />}
          {mode === 'create_tasks' && <CreateTasksMode board={board} />}
          {mode === 'create_board' && canCreateBoard && <CreateBoardMode />}
        </div>
      </aside>
    </div>
  );
}

function ModeTab({ active, icon, label, onClick }: {
  active: boolean; icon: React.ReactNode; label: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-8 px-3 -mb-px text-xs font-medium flex items-center gap-1.5 border-b-2 transition-colors duration-100',
        active ? 'border-brand text-brand' : 'border-transparent text-text-secondary hover:text-text-primary',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// -- Shared "not configured" stub ----------------------------------------

function NotConfigured() {
  return (
    <div className="rounded-md border border-warning/30 bg-warning/10 px-4 py-5 text-sm">
      <p className="font-medium text-warning mb-1">AI not configured</p>
      <p className="text-text-secondary">
        An admin needs to add a Gemini API key in the{' '}
        <Link to="/admin" className="text-brand hover:underline">Admin Panel</Link>{' '}
        before AI features work. See <code className="font-mono text-xs">docs/SETUP-REQUIREMENTS.md</code> for the full procedure.
      </p>
    </div>
  );
}

// -- Chat ----------------------------------------------------------------

function ChatMode({ board }: { board: BoardWithOwner }) {
  const { data: status } = useGeminiStatus();
  const invoke = useGeminiInvoke();
  const { data: items } = useBoardItems(board.id);
  const { data: columns } = useColumns(board.id);
  const [prompt, setPrompt] = useState('');
  const [history, setHistory] = useState<Array<{ role: 'user' | 'ai'; text: string }>>([]);

  const onSend = async () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    setPrompt('');
    setHistory((h) => [...h, { role: 'user', text: trimmed }]);
    try {
      const context = summariseBoard(board, items?.items ?? [], columns ?? []);
      const r = await invoke.mutateAsync({
        prompt: trimmed,
        system: `You are a helpful project-management assistant for the PMS app. Answer the user's question about the board concisely.\n\nBoard context:\n${context}`,
        model: 'gemini-2.5-flash',
        feature: 'chat',
      });
      if (!r.ok) {
        if (r.reason === 'not_configured') {
          setHistory((h) => [...h, { role: 'ai', text: 'AI is not configured. Ask an admin to add a Gemini key.' }]);
        } else {
          setHistory((h) => [...h, { role: 'ai', text: `Error: ${r.reason ?? r.status}` }]);
        }
      } else {
        setHistory((h) => [...h, { role: 'ai', text: r.text ?? '(empty response)' }]);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'AI call failed');
    }
  };

  if (status && !status.configured) return <NotConfigured />;

  return (
    <div className="flex flex-col h-full gap-3">
      <p className="text-sm text-text-secondary">
        Ask anything about <strong>{board.name}</strong>. The AI sees the board's groups,
        columns, and task summaries.
      </p>
      <div className="flex-1 space-y-3 min-h-[120px]">
        {history.map((msg, i) => (
          <div
            key={i}
            className={cn(
              'rounded-md px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed',
              msg.role === 'user' ? 'bg-brand/10 text-text-primary' : 'bg-app/40 text-text-primary',
            )}
          >
            {msg.text}
          </div>
        ))}
        {invoke.isPending && (
          <div className="rounded-md bg-app/40 px-3 py-2 text-sm flex items-center gap-2 text-text-secondary">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Thinking…
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !invoke.isPending) void onSend(); }}
          placeholder="Ask the AI about this board…"
          className="input flex-1 text-sm"
          disabled={invoke.isPending}
        />
        <button
          type="button"
          onClick={() => void onSend()}
          disabled={!prompt.trim() || invoke.isPending}
          aria-label="Send"
          className="btn-primary h-9 px-3"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// -- Create Tasks --------------------------------------------------------

function CreateTasksMode({ board }: { board: BoardWithOwner }) {
  const { data: status } = useGeminiStatus();
  const invoke = useGeminiInvoke();
  const { data: groups } = useGroups(board.id);
  const create = useCreateItem();
  const [prompt, setPrompt] = useState('');
  const [draft, setDraft] = useState<string[] | null>(null);
  const [accepting, setAccepting] = useState(false);

  if (status && !status.configured) return <NotConfigured />;

  const onSuggest = async () => {
    if (!prompt.trim()) return;
    setDraft(null);
    try {
      const r = await invoke.mutateAsync({
        prompt: prompt,
        system: 'Suggest 3–8 short, actionable task titles for the user request. Return ONLY a JSON array of strings — no prose, no markdown fences. Example: ["Set up project repo","Write outline"]',
        model: 'gemini-2.5-flash',
        feature: 'create_tasks',
      });
      if (!r.ok) {
        toast.error(r.reason === 'not_configured' ? 'AI not configured' : `Error: ${r.reason ?? r.status}`);
        return;
      }
      const parsed = parseTaskList(r.text ?? '');
      if (parsed.length === 0) {
        toast.error('AI did not return a clean task list. Try a more specific prompt.');
        return;
      }
      setDraft(parsed);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'AI call failed');
    }
  };

  const onAccept = async () => {
    if (!draft || !groups || groups.length === 0) return;
    setAccepting(true);
    try {
      const groupId = groups[0].id;
      for (const name of draft) {
        await create.mutateAsync({ boardId: board.id, groupId, name });
      }
      toast.success(`Added ${draft.length} task${draft.length === 1 ? '' : 's'}`);
      setDraft(null);
      setPrompt('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Insert failed');
    } finally {
      setAccepting(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-secondary">
        Describe what you need to break down and the AI will suggest tasks to add to
        <strong> {board.name}</strong>.
      </p>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="e.g. Steps to launch our new landing page"
        rows={3}
        className="input py-2 text-sm min-h-[80px]"
        disabled={invoke.isPending}
      />
      <button
        type="button"
        onClick={() => void onSuggest()}
        disabled={!prompt.trim() || invoke.isPending}
        className="btn-primary w-full"
      >
        {invoke.isPending && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
        Suggest tasks
      </button>

      {draft && (
        <div className="rounded-md border border-border-light p-3">
          <p className="text-xs uppercase tracking-wide text-text-secondary font-medium mb-2">
            Suggested ({draft.length})
          </p>
          <ul className="space-y-1.5">
            {draft.map((t, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                <span className="h-1.5 w-1.5 rounded-pill bg-brand shrink-0" />
                <span className="flex-1">{t}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button type="button" onClick={() => setDraft(null)} className="btn-ghost h-8 px-3 text-xs">Discard</button>
            <button
              type="button"
              onClick={() => void onAccept()}
              disabled={accepting}
              className="btn-primary h-8 px-3 text-xs"
            >
              {accepting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Add to board
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// -- Create Board --------------------------------------------------------

function CreateBoardMode() {
  const { data: status } = useGeminiStatus();
  const invoke = useGeminiInvoke();
  const create = useCreateBoard();
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState('');
  const [draft, setDraft] = useState<{ name: string; tasks: string[] } | null>(null);
  const [accepting, setAccepting] = useState(false);

  if (status && !status.configured) return <NotConfigured />;

  const onSuggest = async () => {
    if (!prompt.trim()) return;
    setDraft(null);
    try {
      const r = await invoke.mutateAsync({
        prompt,
        system: 'Suggest a board for the user request. Return ONLY JSON in the shape {"name":"...","tasks":["task 1","task 2",...]} with 5–10 short tasks. No prose, no markdown fences.',
        model: 'gemini-2.5-pro',
        feature: 'create_board',
      });
      if (!r.ok) {
        toast.error(r.reason === 'not_configured' ? 'AI not configured' : `Error: ${r.reason ?? r.status}`);
        return;
      }
      const parsed = parseBoardSpec(r.text ?? '');
      if (!parsed) {
        toast.error('AI did not return a clean board spec. Try again.');
        return;
      }
      setDraft(parsed);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'AI call failed');
    }
  };

  const onAccept = async () => {
    if (!draft) return;
    setAccepting(true);
    try {
      const board = await create.mutateAsync({ name: draft.name, icon_emoji: '✨', board_type: 'main' });
      // create.mutateAsync already invalidates the boards list and the
      // trigger creates the default group. We need to wait briefly and
      // add the tasks to that group.
      // Fetch the first group from this board.
      const { supabase } = await import('@/lib/supabase');
      const groupsResp = await supabase
        .from('groups').select('id').eq('board_id', board.id).order('sort_order').limit(1);
      const groupId = (groupsResp.data?.[0] as { id?: string } | undefined)?.id;
      if (groupId) {
        for (const name of draft.tasks) {
          await supabase.from('items').insert({
            board_id: board.id, group_id: groupId, parent_item_id: null,
            name, task_code: '', created_by: (await supabase.auth.getSession()).data.session!.user.id,
          } as never);
        }
      }
      toast.success(`Board "${board.name}" created with ${draft.tasks.length} tasks`);
      setDraft(null);
      setPrompt('');
      navigate({ to: '/w/$workspace/b/$boardId', params: { workspace: 'main', boardId: board.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Board creation failed');
    } finally {
      setAccepting(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-secondary">
        Describe a project and the AI will create a new board with starter tasks.
      </p>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="e.g. Launch a podcast about machine learning"
        rows={3}
        className="input py-2 text-sm min-h-[80px]"
        disabled={invoke.isPending}
      />
      <button
        type="button"
        onClick={() => void onSuggest()}
        disabled={!prompt.trim() || invoke.isPending}
        className="btn-primary w-full"
      >
        {invoke.isPending && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
        Generate
      </button>

      {draft && (
        <div className="rounded-md border border-border-light p-3 space-y-2">
          <p className="text-sm">
            <span className="text-xs uppercase tracking-wide text-text-secondary font-medium">Board:</span>{' '}
            <strong>{draft.name}</strong>
          </p>
          <p className="text-xs uppercase tracking-wide text-text-secondary font-medium">
            Starter tasks ({draft.tasks.length})
          </p>
          <ul className="space-y-1">
            {draft.tasks.map((t, i) => (
              <li key={i} className="text-sm flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-pill bg-brand shrink-0" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={() => setDraft(null)} className="btn-ghost h-8 px-3 text-xs">Discard</button>
            <button
              type="button"
              onClick={() => void onAccept()}
              disabled={accepting}
              className="btn-primary h-8 px-3 text-xs"
            >
              {accepting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Create board
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// -- Helpers -------------------------------------------------------------

function summariseBoard(board: BoardWithOwner, items: { id: string; name: string; task_code: string }[], columns: { name: string; column_type: string }[]): string {
  const colNames = columns.map((c) => `${c.name} (${c.column_type})`).join(', ');
  const sample = items.slice(0, 12).map((i) => `- ${i.task_code}: ${i.name}`).join('\n');
  return `Board: ${board.name}${board.description ? ` — ${board.description}` : ''}\nColumns: ${colNames}\nTasks (showing up to 12 of ${items.length}):\n${sample}`;
}

function parseTaskList(text: string): string[] {
  try {
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()).slice(0, 20);
  } catch {
    // fallback: split by lines, strip bullets
    return text
      .split(/\r?\n/)
      .map((l) => l.replace(/^[\s•\-*\d.)\]]+/, '').trim())
      .filter((l) => l.length > 0 && l.length < 200)
      .slice(0, 12);
  }
  return [];
}

function parseBoardSpec(text: string): { name: string; tasks: string[] } | null {
  try {
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed.name === 'string' && Array.isArray(parsed.tasks)) {
      return {
        name: parsed.name.slice(0, 80),
        tasks: parsed.tasks.filter((x: unknown): x is string => typeof x === 'string').map((x: string) => x.trim()).filter((x: string) => x.length > 0).slice(0, 20),
      };
    }
  } catch { /* ignore */ }
  return null;
}
