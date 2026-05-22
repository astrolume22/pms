/**
 * /admin recent AI runs — Phase 2 observability.
 *
 * Read-only list of the most recent ai_runs rows (capped at 50). Source
 * of truth is `public.ai_runs`, gated by the `ai_runs_select_admin` RLS
 * policy from migration 0032. Non-admins reading this view get an empty
 * result — RLS is the real fence, the route gate is defence-in-depth.
 *
 * Columns: When · Who · Kind · Status · Target board · Prompt (truncated).
 * Click a row to expand the full prompt + error_message (no DB writes).
 */
import { useState } from 'react';
import { ListTree, RefreshCw, ChevronDown, ChevronRight, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { useAiRuns, type AiRunRow } from '@/hooks/ai-admin';
import { Spinner } from '@/components/Spinner';
import { EmptyMessage } from '@/components/EmptyMessage';
import { cn } from '@/lib/cn';

export function AiRunsSection() {
  const { data, isLoading, isFetching, refetch, isError, error } = useAiRuns();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <section className="bg-surface border border-border-light rounded-md p-6">
      <header className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ListTree className="h-5 w-5 text-brand" />
          <div>
            <h2 className="text-lg font-semibold">Recent AI runs</h2>
            <p className="text-sm text-text-secondary">
              Last 50 calls to <code className="bg-hover px-1 rounded-sm">/api/ai-build</code>,
              newest first. RLS-gated to admins.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          title="Refresh"
          aria-label="Refresh"
          className="h-9 w-9 inline-flex items-center justify-center rounded-base text-text-secondary hover:bg-hover disabled:opacity-40"
        >
          <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
        </button>
      </header>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <Spinner className="h-4 w-4 text-brand" />
          Loading runs…
        </div>
      ) : isError ? (
        <div className="p-3 rounded-base bg-error/10 border border-error/30 text-sm text-error inline-flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            <span className="font-medium">Failed to load runs:</span>{' '}
            {error instanceof Error ? error.message : 'unknown error'}
          </span>
        </div>
      ) : !data || data.length === 0 ? (
        <EmptyMessage
          title="No AI runs yet"
          description="They appear here after any admin clicks Build with AI."
        />
      ) : (
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-text-secondary border-b border-border-light">
                <th className="text-left font-medium px-2 py-2 w-8"></th>
                <th className="text-left font-medium px-2 py-2">When</th>
                <th className="text-left font-medium px-2 py-2">Who</th>
                <th className="text-left font-medium px-2 py-2">Kind</th>
                <th className="text-left font-medium px-2 py-2">Status</th>
                <th className="text-left font-medium px-2 py-2">Target board</th>
                <th className="text-left font-medium px-2 py-2">Prompt</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <RunRow
                  key={row.id}
                  row={row}
                  expanded={expandedId === row.id}
                  onToggle={() => setExpandedId((id) => (id === row.id ? null : row.id))}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RunRow({ row, expanded, onToggle }: { row: AiRunRow; expanded: boolean; onToggle: () => void }) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-border-light hover:bg-hover cursor-pointer align-top"
      >
        <td className="px-2 py-2 text-text-secondary">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </td>
        <td className="px-2 py-2 whitespace-nowrap text-text-secondary">
          {formatTime(row.ran_at)}
        </td>
        <td className="px-2 py-2 whitespace-nowrap font-medium">
          {row.username ?? row.user_id.slice(0, 8)}
        </td>
        <td className="px-2 py-2 whitespace-nowrap">
          <KindBadge kind={row.feature} />
        </td>
        <td className="px-2 py-2 whitespace-nowrap">
          <StatusBadge status={row.status} />
        </td>
        <td className="px-2 py-2 whitespace-nowrap">
          {row.target_board_name ?? (row.target_id ? <span className="text-text-disabled">— deleted —</span> : <span className="text-text-disabled">—</span>)}
        </td>
        <td className="px-2 py-2 max-w-[320px] truncate text-text-secondary">
          {row.prompt ?? ''}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border-light bg-hover/40">
          <td colSpan={7} className="px-3 py-3 text-xs">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div className="uppercase tracking-wide text-text-secondary font-medium mb-1">Prompt</div>
                <pre className="whitespace-pre-wrap font-mono text-[12px] text-text-primary bg-surface rounded-sm border border-border-light p-2 max-h-64 overflow-auto">
                  {row.prompt ?? '(empty)'}
                </pre>
              </div>
              <div>
                <div className="uppercase tracking-wide text-text-secondary font-medium mb-1">Meta</div>
                <dl className="grid grid-cols-[110px_1fr] gap-y-1 text-[12px]">
                  <dt className="text-text-secondary">Model</dt>
                  <dd className="font-mono">{row.model ?? '—'}</dd>
                  <dt className="text-text-secondary">Run id</dt>
                  <dd className="font-mono">{row.id}</dd>
                  <dt className="text-text-secondary">User id</dt>
                  <dd className="font-mono">{row.user_id}</dd>
                  {row.target_id && (
                    <>
                      <dt className="text-text-secondary">Target id</dt>
                      <dd className="font-mono">{row.target_id}</dd>
                    </>
                  )}
                  {row.error_message && (
                    <>
                      <dt className="text-text-secondary">Error</dt>
                      <dd className="text-error">{row.error_message}</dd>
                    </>
                  )}
                </dl>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function KindBadge({ kind }: { kind: AiRunRow['feature'] }) {
  const label = {
    create_board:  'create board',
    add_to_board:  'add to board',
    add_tasks:     'add tasks',
    create_tasks:  'create tasks',
    chat:          'chat',
    suggest:       'suggest',
  }[kind] ?? kind;
  return (
    <span className="inline-flex items-center h-5 px-2 rounded-pill text-xs font-medium bg-brand/15 text-brand">
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status: AiRunRow['status'] }) {
  if (status === 'success') {
    return (
      <span className="inline-flex items-center gap-1 h-5 px-2 rounded-pill text-xs font-medium bg-success/15 text-success">
        <CheckCircle2 className="h-3 w-3" />
        success
      </span>
    );
  }
  if (status === 'not_configured') {
    return (
      <span className="inline-flex items-center gap-1 h-5 px-2 rounded-pill text-xs font-medium bg-warning/15 text-warning">
        <AlertTriangle className="h-3 w-3" />
        no key
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 h-5 px-2 rounded-pill text-xs font-medium bg-error/15 text-error">
      <XCircle className="h-3 w-3" />
      error
    </span>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = (now - d.getTime()) / 1000;
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleString();
}
