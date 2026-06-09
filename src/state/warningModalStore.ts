/**
 * Centered "important warning" modal state.
 *
 * Used as the HIGH-PRIORITY surface for warnings that demand attention
 * (e.g. "3 minutes left on your bio break"). Low-priority notifications
 * keep using sonner toasts via notifyNow(); this store backs
 * notifyImportant() in src/lib/notify.ts.
 *
 * One-slot store — a new show() replaces whatever is currently open.
 * That's intentional: we never want a queue of stacked break warnings.
 */
import { create } from 'zustand';

export interface WarningModalState {
  open: boolean;
  title: string;
  body: string;
  show: (title: string, body: string) => void;
  close: () => void;
}

export const useWarningModalStore = create<WarningModalState>((set) => ({
  open: false,
  title: '',
  body: '',
  show: (title, body) => set({ open: true, title, body }),
  close: () => set({ open: false }),
}));
