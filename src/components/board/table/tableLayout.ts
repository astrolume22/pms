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
export const GUTTER_WIDTH      = 40;   // drag handle / checkbox / expand
export const COMMENT_COL_WIDTH = 40;   // synthetic comment-indicator cell
export const TASK_CODE_COL_WIDTH = 80; // synthetic task-code cell
export const ADD_COL_WIDTH     = 40;   // "+ Add column" cell at the right end

export const SYNTHETIC_PREFIX_WIDTH = COMMENT_COL_WIDTH + TASK_CODE_COL_WIDTH;
