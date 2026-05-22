/**
 * /admin AI status block — Phase 2.
 *
 *  • Pings GET /api/ai-health to confirm the server has GEMINI_API_KEY set
 *    (we never see the value itself, just a boolean).
 *  • Shows the default model + 7-day run count from public.ai_runs
 *    (gated by the ai_runs_select_admin RLS policy).
 *
 * Read-only. Replaces the old `GeminiKeySection` — the key lives in
 * Vercel env vars now, not in the DB.
 */
import { Sparkles, CheckCircle2, XCircle, RefreshCw, AlertTriangle } from 'lucide-react';
import { useAiHealth, useAiRunsCount7d } from '@/hooks/ai-admin';
import { Spinner } from '@/components/Spinner';
import { cn } from '@/lib/cn';

export function AiHealthSection() {
  const health = useAiHealth();
  const count7d = useAiRunsCount7d();

  const refresh = () => {
    void health.refetch();
    void count7d.refetch();
  };

  const ok = health.data?.ok === true;
  const hasKey = health.data?.has_key === true;
  const model  = health.data?.model ?? 'gemini-2.5-flash';

  return (
    <section className="bg-surface border border-border-light rounded-md p-6">
      <header className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-brand" />
          <div>
            <h2 className="text-lg font-semibold">AI engine</h2>
            <p className="text-sm text-text-secondary">
              Server-side Gemini key check + recent activity. Configure via
              Vercel env vars — no DB write needed.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={health.isFetching || count7d.isFetching}
          title="Refresh"
          aria-label="Refresh"
          className="h-9 w-9 inline-flex items-center justify-center rounded-base text-text-secondary hover:bg-hover disabled:opacity-40"
        >
          <RefreshCw className={cn('h-4 w-4', (health.isFetching || count7d.isFetching) && 'animate-spin')} />
        </button>
      </header>

      {health.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <Spinner className="h-4 w-4 text-brand" />
          Checking server status…
        </div>
      ) : health.isError ? (
        <HealthError message={health.error instanceof Error ? health.error.message : 'Failed to fetch /api/ai-health'} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatusCard
            label="GEMINI_API_KEY"
            value={hasKey ? 'Configured' : 'Missing'}
            tone={hasKey ? 'success' : 'error'}
            icon={hasKey
              ? <CheckCircle2 className="h-4 w-4 text-success" />
              : <XCircle      className="h-4 w-4 text-error"   />}
            sub={hasKey ? 'Server env var present' : 'AI features will return 500 until set'}
          />
          <StatusCard
            label="Model"
            value={model}
            tone="neutral"
            sub="Default for /api/ai-build"
          />
          <StatusCard
            label="Runs (7d)"
            value={count7d.isLoading ? '…' : String(count7d.data ?? 0)}
            tone={count7d.isError ? 'error' : 'neutral'}
            sub={count7d.isError ? 'count failed (check RLS)' : 'across all admins'}
          />
        </div>
      )}

      {!ok && hasKey === false && !health.isLoading && !health.isError && (
        <p className="mt-3 text-xs text-text-secondary">
          Set <code className="bg-hover px-1 rounded-sm">GEMINI_API_KEY</code> in
          Vercel → Settings → Environment Variables, then redeploy. The
          frontend doesn't need to know the value.
        </p>
      )}
    </section>
  );
}

function HealthError({ message }: { message: string }) {
  return (
    <div className="p-3 rounded-base bg-error/10 border border-error/30 text-sm text-error inline-flex items-start gap-2">
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
      <span><span className="font-medium">/api/ai-health failed:</span> {message}</span>
    </div>
  );
}

function StatusCard({
  label, value, sub, tone, icon,
}: {
  label: string; value: string; sub?: string;
  tone: 'success' | 'error' | 'neutral';
  icon?: React.ReactNode;
}) {
  const toneClass = tone === 'success'
    ? 'border-success/30 bg-success/5'
    : tone === 'error'
    ? 'border-error/30 bg-error/5'
    : 'border-border-light';
  return (
    <div className={cn('rounded-base border p-3', toneClass)}>
      <div className="text-xs uppercase tracking-wide text-text-secondary font-medium">
        {label}
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-base font-semibold text-text-primary">
        {icon}
        <span className="truncate">{value}</span>
      </div>
      {sub && <div className="mt-0.5 text-xs text-text-secondary">{sub}</div>}
    </div>
  );
}
