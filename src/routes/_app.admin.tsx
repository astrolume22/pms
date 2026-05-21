import { useState } from 'react';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { Sparkles, Eye, EyeOff, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/state/authStore';
import { useGeminiStatus, useSetGeminiKey, useClearGeminiKey } from '@/hooks/gemini';
import { Spinner } from '@/components/Spinner';
import { UsersSection } from '@/components/admin/UsersSection';

export const Route = createFileRoute('/_app/admin')({
  beforeLoad: () => {
    const profile = useAuthStore.getState().profile;
    if (!profile || (profile.role !== 'admin' && !profile.is_super_admin)) {
      toast.error('Admin access required');
      throw redirect({ to: '/' });
    }
  },
  component: AdminPage,
});

function AdminPage() {
  return (
    <div className="px-8 py-6 max-w-[1000px] mx-auto space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Admin Panel</h1>
        <p className="text-sm text-text-secondary mt-1">
          User management + integration keys. All write actions are gated server-side.
        </p>
      </header>

      <UsersSection />
      <GeminiKeySection />
    </div>
  );
}

function GeminiKeySection() {
  const { data: status, isLoading } = useGeminiStatus();
  const setKey = useSetGeminiKey();
  const clearKey = useClearGeminiKey();

  const [draft, setDraft] = useState('');
  const [show, setShow] = useState(false);

  const onSave = async () => {
    if (!draft.trim()) {
      toast.error('Paste your Gemini API key first');
      return;
    }
    try {
      await setKey.mutateAsync(draft.trim());
      setDraft('');
      toast.success('Gemini key saved (encrypted)');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save key');
    }
  };

  const onClear = async () => {
    if (!window.confirm('Remove the Gemini API key? AI features will stop working until you set a new one.')) return;
    try {
      await clearKey.mutateAsync();
      toast.success('Gemini key removed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not clear key');
    }
  };

  return (
    <section className="bg-surface border border-border-light rounded-md p-6">
      <header className="flex items-center gap-2 mb-1">
        <Sparkles className="h-5 w-5 text-brand" />
        <h2 className="text-lg font-semibold">Gemini API key</h2>
      </header>
      <p className="text-sm text-text-secondary mb-4">
        Powers the AI Create Board / Create Tasks / Chat features. Get a key at
        {' '}
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer"
           className="text-brand hover:underline">Google AI Studio</a>.
        The key is encrypted with <code>pgp_sym_encrypt</code> using a server-side
        master passphrase — the value is never sent back to the browser after Save.
      </p>

      {isLoading ? (
        <Spinner className="h-5 w-5 text-brand" />
      ) : status?.configured ? (
        <div className="flex items-center justify-between p-3 rounded-base bg-success/10 border border-success/30 mb-3">
          <span className="text-sm font-medium text-success">A Gemini key is configured</span>
          <button
            type="button"
            onClick={onClear}
            disabled={clearKey.isPending}
            className="inline-flex items-center gap-1 h-7 px-2 rounded-sm text-xs font-medium text-error hover:bg-error/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </button>
        </div>
      ) : (
        <div className="p-3 rounded-base bg-warning/10 border border-warning/30 mb-3 text-sm text-warning">
          No key configured — AI features will show "Not configured" until you save one below.
        </div>
      )}

      <label className="block">
        <span className="block text-xs uppercase tracking-wide text-text-secondary font-medium mb-1">
          {status?.configured ? 'Replace key' : 'Paste key'}
        </span>
        <div className="relative">
          <input
            type={show ? 'text' : 'password'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="AIza…"
            spellCheck={false}
            autoComplete="off"
            className="input pr-10 font-mono"
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? 'Hide key' : 'Show key'}
            className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded-sm text-text-secondary hover:bg-hover"
            tabIndex={-1}
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </label>

      <div className="mt-3 flex items-center justify-end">
        <button
          type="button"
          onClick={onSave}
          disabled={setKey.isPending || !draft.trim()}
          className="btn-primary inline-flex items-center gap-1"
        >
          {setKey.isPending && <Spinner className="h-3 w-3 mr-1" />}
          <Save className="h-3.5 w-3.5" />
          Save key
        </button>
      </div>
    </section>
  );
}
