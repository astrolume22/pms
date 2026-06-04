/**
 * Window-blur guard for inline-editing onBlur handlers.
 *
 * Returns TRUE when the current blur event is caused by the entire
 * BROWSER WINDOW losing focus (alt-tab to another app, click on a
 * different window) — as opposed to the user clicking another element
 * inside THIS window.
 *
 * Use inside an input's `onBlur` to skip commit + close in the window-
 * blur case:
 *
 *   onBlur={() => { if (!isBlurFromWindowLostFocus()) void commit(); }}
 *
 * Background: `document.hasFocus()` returns false exactly when the
 * window itself is unfocused. When the user alt-tabs to another app
 * for even ~1ms and comes back, the focused input fires a blur event;
 * if we commit and close on that blur, the user's in-progress typing
 * is lost and they have to re-open the cell. By skipping the handler
 * in the window-blur case, the input stays mounted and the browser
 * restores focus to it when the window regains focus, so the user can
 * keep typing where they left off.
 *
 * Element-blur (clicking another cell or pressing Tab) still passes
 * the guard and triggers commit normally.
 */
export function isBlurFromWindowLostFocus(): boolean {
  if (typeof document === 'undefined') return false;
  return !document.hasFocus();
}
