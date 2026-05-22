/**
 * Client-side applier for the "Build with AI" actions list.
 *
 * Walks the actions in order. Maintains a refMap that resolves the AI's
 * synthetic refs (group_ref / column_ref / label_ref / task_ref) into
 * real DB ids as rows are created. Primed at the start with refs from
 * the engine's BOARD CONTEXT (existing rows the AI saw) so actions can
 * point at pre-existing groups / columns / labels.
 *
 * Each step is a single Supabase write; the applier doesn't try to be
 * clever about transactions — if step N fails, earlier steps stay
 * committed and we surface which action failed. The Preview step in
 * the modal lets the admin sanity-check the plan before any writes,
 * so partial-apply is rare in practice.
 *
 * Progress is reported via the onProgress callback so the modal can
 * render "creating group 'Discovery'…".
 */
import { supabase } from './supabase';

// ---------- Types mirrored from api/_shared/actions-schema.ts ----------
// Kept duplicated (not imported from api/) because the api/ directory
// is the Vercel Function code; the client bundle should not import
// from there. The Zod schema lives server-side; the client trusts the
// validated output the function returned.

type Ref = string;

type CellValue =
  | { value: string | number | boolean }
  | { label_ref: Ref }
  | { label_refs: Ref[] }
  | { checked: boolean }
  | { url: string; label?: string };

type ColumnTypeForCreate =
  | 'text' | 'status' | 'people' | 'date'
  | 'priority' | 'numbers' | 'checkbox' | 'dropdown' | 'link';

export type Action =
  | { type: 'create_group'; ref?: Ref; name: string; color?: string }
  | {
      type: 'create_column';
      ref?: Ref;
      column_type: ColumnTypeForCreate;
      name: string;
      labels?: { ref?: Ref; name: string; color: string }[];
    }
  | { type: 'create_label'; ref?: Ref; column_ref: Ref; name: string; color: string }
  | { type: 'create_task'; ref?: Ref; group_ref: Ref; name: string; cells?: Record<Ref, CellValue> }
  | { type: 'update_task_status'; task_ref: Ref; status_ref: Ref };

// Engine context shape (what api/ai-build.ts returns alongside actions).
export interface EngineContextLabel { id: string; ref: string; name: string; color: string }
export interface EngineContextColumn { id: string; ref: string; name: string; column_type: string; labels: EngineContextLabel[] }
export interface EngineContextGroup { id: string; ref: string; name: string; color: string }
export interface EngineContext {
  board_id?: string;
  board_name?: string;
  groups: EngineContextGroup[];
  columns: EngineContextColumn[];
}

// ---------- Plan summary (used by the Preview screen) ------------------
export interface PlanSummary {
  groups: number;
  columns: number;
  labels: number;      // both inline-in-column and standalone create_label
  tasks: number;
  status_updates: number;
}
export function summarizePlan(actions: Action[]): PlanSummary {
  const s: PlanSummary = { groups: 0, columns: 0, labels: 0, tasks: 0, status_updates: 0 };
  for (const a of actions) {
    switch (a.type) {
      case 'create_group':         s.groups += 1; break;
      case 'create_column':        s.columns += 1; s.labels += (a.labels?.length ?? 0); break;
      case 'create_label':         s.labels += 1; break;
      case 'create_task':          s.tasks += 1; break;
      case 'update_task_status':   s.status_updates += 1; break;
    }
  }
  return s;
}

// ---------- The applier -----------------------------------------------
export interface ApplyArgs {
  boardId: string;
  actions: Action[];
  context: EngineContext;
  userId: string;
  // Called before EACH action. The modal renders the description.
  onProgress?: (info: { index: number; total: number; description: string }) => void;
}

export interface ApplyResult {
  applied: number;
  failedAt?: { index: number; description: string; error: string };
}

export async function applyActions(args: ApplyArgs): Promise<ApplyResult> {
  const { boardId, actions, context, userId, onProgress } = args;

  // Prime the refMap from the engine context — refs the AI saw are real
  // ids already.
  const groupIdByRef: Record<string, string> = {};
  const columnIdByRef: Record<string, string> = {};
  const labelIdByRef: Record<string, string> = {};
  const taskIdByRef: Record<string, string> = {};
  for (const g of context.groups) groupIdByRef[g.ref] = g.id;
  for (const c of context.columns) {
    columnIdByRef[c.ref] = c.id;
    for (const l of c.labels) labelIdByRef[l.ref] = l.id;
  }

  // We need next sort_order counters per group / per column so newly
  // inserted rows append correctly. Fetch the current max once at the
  // start; bump locally as we insert.
  const { data: existingGroups } = await supabase
    .from('groups').select('sort_order').eq('board_id', boardId);
  let nextGroupSort = ((existingGroups ?? []).reduce(
    (m: number, g: { sort_order: number }) => Math.max(m, g.sort_order), -1,
  )) + 1;
  const { data: existingColumns } = await supabase
    .from('columns').select('sort_order').eq('board_id', boardId);
  let nextColumnSort = ((existingColumns ?? []).reduce(
    (m: number, c: { sort_order: number }) => Math.max(m, c.sort_order), -1,
  )) + 1;
  const itemSortByGroup = new Map<string, number>();
  async function nextItemSort(groupId: string): Promise<number> {
    if (itemSortByGroup.has(groupId)) {
      const v = itemSortByGroup.get(groupId)! + 1;
      itemSortByGroup.set(groupId, v);
      return v;
    }
    const { data: existing } = await supabase
      .from('items').select('sort_order').eq('group_id', groupId);
    const v = ((existing ?? []).reduce(
      (m: number, i: { sort_order: number }) => Math.max(m, i.sort_order), -1,
    )) + 1;
    itemSortByGroup.set(groupId, v);
    return v;
  }
  // Label sort_order — bumped per column as we insert labels.
  const labelSortByColumn = new Map<string, number>();
  async function nextLabelSort(columnId: string): Promise<number> {
    if (labelSortByColumn.has(columnId)) {
      const v = labelSortByColumn.get(columnId)! + 1;
      labelSortByColumn.set(columnId, v);
      return v;
    }
    const { data: existing } = await supabase
      .from('column_labels').select('sort_order').eq('column_id', columnId);
    const v = ((existing ?? []).reduce(
      (m: number, l: { sort_order: number }) => Math.max(m, l.sort_order), -1,
    )) + 1;
    labelSortByColumn.set(columnId, v);
    return v;
  }

  // Resolve a column ref → real id (and column_type if needed).
  function resolveColumnId(ref: string): string | null {
    return columnIdByRef[ref] ?? null;
  }

  // Cell-value translator: turns AI refs into real label_ids; passes
  // through scalar values as-is.
  function translateCell(value: CellValue, columnType: string): unknown | null {
    if ('label_ref' in value) {
      const lid = labelIdByRef[value.label_ref];
      return lid ? { label_id: lid } : null;
    }
    if ('label_refs' in value) {
      const ids = value.label_refs.map((r) => labelIdByRef[r]).filter(Boolean);
      return ids.length ? { label_ids: ids } : null;
    }
    if ('checked' in value) return { checked: !!value.checked };
    if ('url' in value)     return { url: value.url, label: value.label ?? null };
    if ('value' in value) {
      // Shape matches DB conventions per column_type.
      if (columnType === 'date')    return { value: String(value.value) };
      if (columnType === 'numbers') return { value: Number(value.value) };
      return { value: String(value.value) };
    }
    return null;
  }

  // -------------- The action loop --------------
  for (let i = 0; i < actions.length; i += 1) {
    const a = actions[i];
    const description = describeAction(a);
    onProgress?.({ index: i, total: actions.length, description });
    try {
      switch (a.type) {
        case 'create_group': {
          const { data, error } = await supabase
            .from('groups')
            .insert({
              board_id: boardId,
              name: a.name,
              color: a.color ?? '#579BFC',
              sort_order: nextGroupSort,
            } as never)
            .select('id')
            .single();
          if (error) throw error;
          nextGroupSort += 1;
          if (a.ref) groupIdByRef[a.ref] = (data as { id: string }).id;
          break;
        }

        case 'create_column': {
          const { data: col, error } = await supabase
            .from('columns')
            .insert({
              board_id: boardId,
              name: a.name,
              column_type: a.column_type,
              sort_order: nextColumnSort,
              width: defaultWidthFor(a.column_type),
            } as never)
            .select('id, column_type')
            .single();
          if (error) throw error;
          nextColumnSort += 1;
          const colId = (col as { id: string }).id;
          if (a.ref) columnIdByRef[a.ref] = colId;

          // Inline label seeds (status / priority / dropdown only).
          if (a.labels && a.labels.length > 0) {
            const isLabelType = a.column_type === 'status'
              || a.column_type === 'priority'
              || a.column_type === 'dropdown';
            if (isLabelType) {
              for (const l of a.labels) {
                const sort = await nextLabelSort(colId);
                const { data: lab, error: lErr } = await supabase
                  .from('column_labels')
                  .insert({
                    column_id: colId,
                    name: l.name,
                    color: l.color,
                    sort_order: sort,
                  } as never)
                  .select('id')
                  .single();
                if (lErr) throw lErr;
                if (l.ref) labelIdByRef[l.ref] = (lab as { id: string }).id;
              }
            }
          }
          break;
        }

        case 'create_label': {
          const colId = resolveColumnId(a.column_ref);
          if (!colId) throw new Error(`unknown column_ref "${a.column_ref}"`);
          const sort = await nextLabelSort(colId);
          const { data, error } = await supabase
            .from('column_labels')
            .insert({
              column_id: colId,
              name: a.name,
              color: a.color,
              sort_order: sort,
            } as never)
            .select('id')
            .single();
          if (error) throw error;
          if (a.ref) labelIdByRef[a.ref] = (data as { id: string }).id;
          break;
        }

        case 'create_task': {
          const groupId = groupIdByRef[a.group_ref];
          if (!groupId) throw new Error(`unknown group_ref "${a.group_ref}"`);
          const sort = await nextItemSort(groupId);
          const { data: item, error } = await supabase
            .from('items')
            .insert({
              board_id: boardId,
              group_id: groupId,
              name: a.name,
              task_code: '',           // trigger fills it
              sort_order: sort,
              created_by: userId,
            } as never)
            .select('id')
            .single();
          if (error) throw error;
          const itemId = (item as { id: string }).id;
          if (a.ref) taskIdByRef[a.ref] = itemId;

          // Cell values.
          if (a.cells && Object.keys(a.cells).length > 0) {
            for (const [colRef, raw] of Object.entries(a.cells)) {
              const colId = resolveColumnId(colRef);
              if (!colId) continue;  // skip silently; the column may be
              // a stale ref the model used incorrectly.
              const { data: colMeta } = await supabase
                .from('columns').select('column_type').eq('id', colId).single();
              const columnType = (colMeta as { column_type?: string } | null)?.column_type ?? 'text';
              const dbValue = translateCell(raw, columnType);
              if (dbValue == null) continue;
              const { error: vErr } = await supabase
                .from('item_column_values')
                .upsert({
                  item_id: itemId,
                  column_id: colId,
                  value: dbValue,
                  updated_by: userId,
                } as never, { onConflict: 'item_id,column_id' });
              if (vErr) throw vErr;
            }
          }
          break;
        }

        case 'update_task_status': {
          const itemId = taskIdByRef[a.task_ref];
          const labelId = labelIdByRef[a.status_ref];
          if (!itemId || !labelId) throw new Error('unknown task_ref or status_ref');
          // Find the status column on this board (single status column
          // assumption for V1; if there are multiple we pick the first).
          const { data: statusCols } = await supabase
            .from('columns')
            .select('id')
            .eq('board_id', boardId)
            .eq('column_type', 'status')
            .is('archived_at', null)
            .order('sort_order')
            .limit(1);
          const statusColId = (statusCols ?? [])[0]?.id;
          if (!statusColId) throw new Error('no status column on this board');
          const { error } = await supabase
            .from('item_column_values')
            .upsert({
              item_id: itemId,
              column_id: statusColId,
              value: { label_id: labelId },
              updated_by: userId,
            } as never, { onConflict: 'item_id,column_id' });
          if (error) throw error;
          break;
        }

        default: {
          // Exhaustiveness check — TS narrows `a` to never here.
          const _unreachable: never = a;
          void _unreachable;
        }
      }
    } catch (err) {
      return {
        applied: i,
        failedAt: {
          index: i,
          description,
          error: formatErr(err),
        },
      };
    }
  }
  return { applied: actions.length };
}

// Format both PostgrestError (plain object: {code, message, details, hint})
// and standard Error / string into a readable single line. Without this,
// String({...}) renders "[object Object]" which is what the modal toast
// was showing — useless for debugging.
function formatErr(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { message?: string; code?: string; details?: string; hint?: string };
    if (typeof e.message === 'string' && e.message.length > 0) {
      const parts: string[] = [e.message];
      if (e.code)    parts.push(`[${e.code}]`);
      if (e.details) parts.push(`— ${e.details}`);
      if (e.hint)    parts.push(`(${e.hint})`);
      return parts.join(' ');
    }
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

// ---------- Helpers ----------------------------------------------------
function defaultWidthFor(t: ColumnTypeForCreate): number {
  switch (t) {
    case 'status':
    case 'priority':   return 180;
    case 'dropdown':   return 200;
    case 'people':     return 160;
    case 'date':       return 140;
    case 'numbers':    return 140;
    case 'link':       return 220;
    case 'checkbox':   return 100;
    case 'text':       return 220;
    default:           return 180;
  }
}

export function describeAction(a: Action): string {
  switch (a.type) {
    case 'create_group':       return `Create group "${a.name}"`;
    case 'create_column':      return `Create ${a.column_type} column "${a.name}"`
      + (a.labels?.length ? ` (${a.labels.length} labels)` : '');
    case 'create_label':       return `Add label "${a.name}"`;
    case 'create_task':        return `Add task "${a.name}"`;
    case 'update_task_status': return `Set status on a task`;
  }
}
