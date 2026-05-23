/**
 * Shared layout constants for the board table.
 *
 * The table mixes three kinds of columns:
 *   1. The gutter (drag handle + checkbox + subitem chevron) — fixed 40 px,
 *      sticky to the left edge.
 *   2. User-defined columns from `public.columns` (Task name, Status, …)
 *      — width is editable per column, stored in the DB.
 *   3. Synthetic, UI-only columns that don't live in the DB. We use them
 *      to match Monday's reference table:
 *        • A narrow Comment-indicator cell (opens the task panel)
 *        • A Task Code cell (read-only, sourced from `items.task_code`)
 *
 * Putting the constants in one place keeps the column-header row,
 * every item row, and the column-footer summaries aligned to the
 * exact same widths.
 */
// Premium polish row anatomy (brief section A):
//   1. Drag handle    24px (hover-only)
//   2. Checkbox       40px
//   3. Expand caret   24px (only shown if has subtasks)
// → total gutter 88px (sub-cells declared below).
export const GUTTER_DRAG_WIDTH   = 24;
export const GUTTER_CHECK_WIDTH  = 40;
export const GUTTER_EXPAND_WIDTH = 24;
export const GUTTER_WIDTH        =
  GUTTER_DRAG_WIDTH + GUTTER_CHECK_WIDTH + GUTTER_EXPAND_WIDTH;   // 88

export const COMMENT_COL_WIDTH   = 40;    // synthetic comment-indicator
export const TASK_CODE_COL_WIDTH = 100;   // synthetic task-code cell (brief A.6)
export const ADD_COL_WIDTH       = 40;    // "+ Add column" cell at the right end

// Task name is the only fluid column. The brief specifies "flex (min 240px,
// max 360px)" — we enforce via CSS min/max on the cell wrapper. The DB-stored
// column width is the *initial* value and gets clamped at render time so
// columns above/below the band auto-correct.
export const TASK_NAME_MIN_WIDTH = 240;
export const TASK_NAME_MAX_WIDTH = 360;

export const SYNTHETIC_PREFIX_WIDTH = COMMENT_COL_WIDTH + TASK_CODE_COL_WIDTH;
