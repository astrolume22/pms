/**
 * Per-user, in-memory undo stack — holds the last 10 board actions
 * the CURRENT user performed THIS session.
 *
 * Design:
 *   • One Zustand store per browser tab, NOT persisted to disk.
 *     Refresh clears it on purpose — undo is a within-session safety
 *     net, not a permanent audit log.
 *   • Each entry holds a self-contained async `undo()` closure that
 *     reverses the action by calling supabase directly + invalidating
 *     the relevant React Query cache + publishing a board-sync event
 *     so other tabs (same browser OR cross-machine via Realtime once
 *     it's flowing) catch the reversal.
 *   • Max depth 10 — pushing an 11th drops the oldest.
 *   • An `isUndoing` re-entrancy guard prevents an undo's own mutation
 *     from being recorded as a NEW undoable action (which would create
 *     an infinite ping-pong if the user kept hitting Ctrl+Z).
 *   • If an undo fails (RLS, network), the entry is put BACK on the
 *     stack so the user can retry, and the error is toasted instead of
 *     silently swallowed.
 *
 * Per-user by construction: the stack lives in this tab only, so it
 * naturally contains only THIS user's actions. A user's Ctrl+Z can
 * never reach across users.
 */
import { create } from 'zustand';
import { toast } from 'sonner';

export interface UndoableAction {
  /** Stable id for React keys + logging. */
  id: string;
  /** When the action was pushed. Useful for "undo last action up to N seconds ago" if ever needed. */
  ts: number;
  /** Human-readable description shown in the success toast. */
  description: string;
  /** Reverses the action. Must NOT push another entry onto the stack (the runner sets isUndoing for us). */
  undo: () => Promise<void>;
}

interface UndoState {
  stack: UndoableAction[];
  isUndoing: boolean;

  /** Push a new undoable action. No-op when an undo is currently in flight. */
  push: (entry: Pick<UndoableAction, 'description' | 'undo'>) => void;

  /** Pop + run the most recently pushed action. Re-enqueues on failure. */
  runTop: () => Promise<void>;

  /** Wipe the stack (used by tests; not currently called by UI). */
  clear: () => void;
}

const MAX_DEPTH = 10;

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const useUndoStore = create<UndoState>((set, get) => ({
  stack: [],
  isUndoing: false,

  push: ({ description, undo }) => {
    // Re-entrancy guard — a mutation fired BY an undo closure must not
    // be recorded as a new undoable action. The runner below sets
    // isUndoing for the duration of the reverse operation.
    if (get().isUndoing) return;
    const entry: UndoableAction = { id: newId(), ts: Date.now(), description, undo };
    const next = [...get().stack, entry];
    while (next.length > MAX_DEPTH) next.shift();
    set({ stack: next });
  },

  runTop: async () => {
    const { stack, isUndoing } = get();
    if (isUndoing) return;
    if (stack.length === 0) {
      toast('Nothing to undo');
      return;
    }
    const top = stack[stack.length - 1];
    // Pop optimistically AND set the re-entrancy guard so the reverse
    // mutation doesn't re-push.
    set({ isUndoing: true, stack: stack.slice(0, -1) });
    try {
      await top.undo();
      toast.success('Undone: ' + top.description);
    } catch (err) {
      // Re-enqueue so the user can retry.
      set((s) => ({ stack: [...s.stack, top] }));
      const message = err instanceof Error ? err.message : 'unknown error';
      toast.error("Couldn't undo " + top.description + ' — ' + message);
    } finally {
      set({ isUndoing: false });
    }
  },

  clear: () => set({ stack: [], isUndoing: false }),
}));
