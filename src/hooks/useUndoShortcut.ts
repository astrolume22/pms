/**
 * Wire Ctrl+Z (Windows/Linux) AND Cmd+Z (Mac) to the undo stack.
 *
 * Important: when the user is typing in a real text field
 * (input / textarea / contenteditable), let the browser's native
 * text-edit undo handle it. Only fire the BOARD undo when focus is
 * elsewhere (a chip cell, the board surface, the toolbar, etc.).
 *
 * Ctrl+Shift+Z / Cmd+Shift+Z is the conventional REDO chord — we
 * intentionally do NOT consume it here (we have no redo stack yet),
 * so the browser default behaviour for whatever has focus runs.
 */
import { useEffect } from 'react';
import { useUndoStore } from '@/lib/undoStack';

function isTextEditTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  // contenteditable — e.g. the task-name inline editor uses
  // contentEditable, so respect it too.
  const html = target as HTMLElement;
  if (html.isContentEditable) return true;
  return false;
}

export function useUndoShortcut(): void {
  const runTop = useUndoStore((s) => s.runTop);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isCmd = e.metaKey;
      const isCtrl = e.ctrlKey && !e.metaKey;
      const isUndoChord = (isCmd || isCtrl) && !e.shiftKey && !e.altKey
        && (e.key === 'z' || e.key === 'Z');
      if (!isUndoChord) return;
      if (isTextEditTarget(e.target)) return;
      e.preventDefault();
      void runTop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [runTop]);
}
