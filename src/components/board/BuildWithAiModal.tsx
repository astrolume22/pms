/**
 * "Build with AI" modal — admin only. Two-step flow:
 *   1. Prompt → Preview: calls /api/ai-build and shows a human-readable
 *      summary of the actions the AI plans to take. Nothing has been
 *      written to the DB at this point.
 *   2. Preview → Apply: walks the actions client-side via the applier.
 *      Soft confirm at 20+ actions. Live progress per step. If a step
 *      fails, we surface which one and what the error was; earlier
 *      successful steps stay applied (board can be edited normally to
 *      clean up).
 *
 * The button that opens this lives in BoardHeader, gated on isAdmin.
 */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Sparkles, Loader2, ChevronRight, AlertTriangle, CheckCircle2, Wand2 } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { Spinner } from '@/components/Spinner';
import { useAiBuild, type AiBuildResponse } from '@/hooks/ai-build';
import {
  applyActions, summarizePlan, describeAction,
  type Action, type EngineContext,
} from '@/lib/ai-applier';
import { useAuthStore } from '@/state/authStore';
import { useQueryClient } from '@tanstack/react-query';

interface BuildWithAiModalProps {
  open: boolean;
  onClose: () => void;
  boardId: string;
  boardName: string;
}

type Step = 'prompt' | 'previewing' | 'preview' | 'applying' | 'done' | 'error';

const SOFT_CONFIRM_THRESHOLD = 20;

const EXAMPLE_PROMPTS = [
  'Add 4 task ideas to this board for a customer onboarding flow.',
  'Add a "QA" group with 5 testing tasks (regression, e2e, accessibility, performance, security review).',
  'Add a Priority column if it doesn\'t exist, and set High/Medium/Low on existing tasks based on their names.',
];

export function BuildWithAiModal({ open, onClose, boardId, boardName }: BuildWithAiModalProps) {
  const profile = useAuthStore((s) => s.profile);
  const qc = useQueryClient();
  const aiBuild = useAiBuild();

  const [prompt, setPrompt] = useState('');
  const [plan, setPlan] = useState<AiBuildResponse | null>(null);
  const [step, setStep] = useState<Step>('prompt');
  const [progress, setProgress] = useState<{ index: number; total: number; description: string } | null>(null);
  const [failure, setFailure] = useState<{ index: number; description: string; error: string } | null>(null);
  const [appliedCount, setAppliedCount] = useState<number>(0);

  // Reset all transient state when the modal closes.
  useEffect(() => {
    if (!open) {
      setPrompt('');
      setPlan(null);
      setStep('prompt');
      setProgress(null);
      setFailure(null);
      setAppliedCount(0);
    }
  }, [open]);

  const handlePreview = async () => {
    const trimmed = prompt.trim();
    if (!trimmed) { toast.error('Write a prompt first'); return; }
    setStep('previewing');
    try {
      const resp = await aiBuild.mutateAsync({
        prompt: trimmed,
        kind: 'add_to_board',
        boardId,
      });
      if (!resp.actions || resp.actions.length === 0) {
        toast.error('AI returned no actions — try a more specific prompt');
        setStep('prompt');
        return;
      }
      setPlan(resp);
      setStep('preview');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'AI build failed');
      setStep('prompt');
    }
  };

  const handleApply = async () => {
    if (!plan || !profile) return;
    const total = plan.actions.length;
    if (total > SOFT_CONFIRM_THRESHOLD) {
      const ok = window.confirm(`Apply ${total} actions to this board?`);
      if (!ok) return;
    }
    setStep('applying');
    setProgress({ index: 0, total, description: 'Starting…' });
    const result = await applyActions({
      boardId,
      actions: plan.actions,
      context: plan.context,
      userId: profile.id,
      onProgress: (p) => setProgress(p),
    });
    setAppliedCount(result.applied);
    if (result.failedAt) {
      setFailure(result.failedAt);
      setStep('error');
    } else {
      setStep('done');
      toast.success(`Built ${result.applied} item${result.applied === 1 ? '' : 's'}`);
    }
    // Invalidate everything board-related so the new rows show up.
    void qc.invalidateQueries({ queryKey: ['groups', 'board', boardId] });
    void qc.invalidateQueries({ queryKey: ['columns', 'board', boardId] });
    void qc.invalidateQueries({ queryKey: ['labels', 'board', boardId] });
    void qc.invalidateQueries({ queryKey: ['items', 'board', boardId] });
  };

  const summary = plan ? summarizePlan(plan.actions) : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Build with AI — ${boardName}`}
      size="lg"
      footer={renderFooter()}
    >
      <div className="space-y-4">
        {/* Header ribbon — explains the flow at a glance. */}
        <div className="flex items-start gap-3 rounded-base bg-brand/8 border border-brand/30 p-3 text-sm">
          <Sparkles className="h-5 w-5 text-brand shrink-0 mt-0.5" />
          <div className="text-text-secondary">
            <p className="text-text-primary font-medium mb-1">Paste an Optimus prompt below.</p>
            <p>The AI will plan groups, columns, labels, and tasks. You'll preview the plan before anything writes to the board.</p>
          </div>
        </div>

        {/* PROMPT step */}
        {(step === 'prompt' || step === 'previewing') && (
          <>
            <label className="block">
              <span className="block text-xs uppercase tracking-wide text-text-secondary font-medium mb-1">Prompt</span>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder='e.g. "Build a Shopify launch board: Discovery, Build, QA, Launch — each as a group with 3-4 tasks. Add a status column."'
                rows={8}
                disabled={step === 'previewing'}
                className="w-full input min-h-[140px] py-2 text-[13px] leading-relaxed font-mono resize-y"
                autoFocus
              />
            </label>
            <div>
              <p className="text-xs uppercase tracking-wide text-text-secondary font-medium mb-1.5">Examples</p>
              <ul className="space-y-1">
                {EXAMPLE_PROMPTS.map((p) => (
                  <li key={p}>
                    <button
                      type="button"
                      onClick={() => setPrompt(p)}
                      disabled={step === 'previewing'}
                      className="text-left text-[12px] text-text-secondary hover:text-brand hover:underline disabled:opacity-50"
                    >
                      {p}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}

        {/* PREVIEW step */}
        {step === 'preview' && plan && summary && (
          <div className="space-y-3">
            <div className="rounded-base border border-border-light bg-app/40 p-3 text-sm">
              <p className="font-medium mb-1.5">Plan summary</p>
              <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-text-secondary">
                {summary.groups        > 0 && <li>{summary.groups} group{summary.groups === 1 ? '' : 's'}</li>}
                {summary.columns       > 0 && <li>{summary.columns} column{summary.columns === 1 ? '' : 's'}</li>}
                {summary.labels        > 0 && <li>{summary.labels} label{summary.labels === 1 ? '' : 's'}</li>}
                {summary.tasks         > 0 && <li>{summary.tasks} task{summary.tasks === 1 ? '' : 's'}</li>}
                {summary.status_updates > 0 && <li>{summary.status_updates} status update{summary.status_updates === 1 ? '' : 's'}</li>}
              </ul>
              {plan.notes && (
                <p className="text-xs text-text-secondary mt-2 italic">"{plan.notes}"</p>
              )}
              {plan.actions.length > SOFT_CONFIRM_THRESHOLD && (
                <p className="text-xs text-warning mt-2 inline-flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Large plan — you'll be asked to confirm before applying.
                </p>
              )}
            </div>

            <div className="rounded-base border border-border-light max-h-[280px] overflow-y-auto">
              <ol className="divide-y divide-border-light text-[13px]">
                {plan.actions.map((a: Action, i: number) => (
                  <li key={i} className="flex items-center gap-2 px-3 py-1.5 text-text-secondary">
                    <span className="text-text-disabled tabular-nums w-6 text-right shrink-0">{i + 1}</span>
                    <ChevronRight className="h-3 w-3 shrink-0 text-text-disabled" />
                    <span>{describeAction(a)}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}

        {/* APPLYING step */}
        {step === 'applying' && progress && (
          <div className="rounded-base border border-border-light bg-app/40 p-4">
            <div className="flex items-center gap-3 mb-3">
              <Loader2 className="h-5 w-5 text-brand animate-spin" />
              <p className="text-sm font-medium">Applying actions…</p>
              <span className="ml-auto text-xs text-text-secondary tabular-nums">
                {progress.index + 1} / {progress.total}
              </span>
            </div>
            <p className="text-[13px] text-text-secondary truncate">{progress.description}</p>
            <div className="mt-3 h-1.5 rounded-pill bg-app overflow-hidden">
              <div
                className="h-full bg-brand transition-[width] duration-100"
                style={{ width: `${((progress.index + 1) / Math.max(progress.total, 1)) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* DONE step */}
        {step === 'done' && (
          <div className="rounded-base border border-success/40 bg-success/10 p-4 flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-text-primary">Build complete</p>
              <p className="text-text-secondary mt-0.5">Applied {appliedCount} action{appliedCount === 1 ? '' : 's'}.</p>
            </div>
          </div>
        )}

        {/* ERROR step */}
        {step === 'error' && failure && (
          <div className="rounded-base border border-error/40 bg-error/10 p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-error shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-text-primary">Stopped at action {failure.index + 1}</p>
              <p className="text-text-secondary mt-0.5">{failure.description}</p>
              <p className="text-text-secondary mt-1 text-[12px] font-mono break-all">{failure.error}</p>
              <p className="text-[11px] text-text-disabled mt-2">
                {appliedCount} earlier action{appliedCount === 1 ? '' : 's'} did succeed and remain on the board.
              </p>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );

  function renderFooter() {
    if (step === 'prompt' || step === 'previewing') {
      return (
        <>
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button
            type="button"
            onClick={() => void handlePreview()}
            disabled={step === 'previewing' || !prompt.trim()}
            className="btn-primary inline-flex items-center gap-2"
          >
            {step === 'previewing' && <Spinner className="h-3 w-3" />}
            <Wand2 className="h-4 w-4" />
            Preview
          </button>
        </>
      );
    }
    if (step === 'preview') {
      return (
        <>
          <button type="button" onClick={() => setStep('prompt')} className="btn-secondary">
            Back
          </button>
          <button
            type="button"
            onClick={() => void handleApply()}
            className="btn-primary inline-flex items-center gap-2"
          >
            <Sparkles className="h-4 w-4" />
            Apply
          </button>
        </>
      );
    }
    if (step === 'applying') {
      return <span className="text-xs text-text-secondary">Applying — please don't close this dialog…</span>;
    }
    if (step === 'done' || step === 'error') {
      return (
        <button type="button" onClick={onClose} className="btn-primary">
          Close
        </button>
      );
    }
    return null;
  }
}
