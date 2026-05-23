/**
 * SERVER TWIN of src/lib/ai-applier.ts (Phase 3b).
 *
 * Same Action types (from api/_shared/actions-schema.ts), same refMap
 * conventions, same sort_order computation, same cell-value→DB-JSON
 * translation. The only structural difference is that the caller passes
 * in a SupabaseClient — so this file works equally with the anon JWT
 * (for parity with the client) or with the service-role JWT (used by
 * api/mcp.ts). Auth is therefore the caller's responsibility.
 *
 * ⚠️ KEEP IN SYNC WITH src/lib/ai-applier.ts
 *   If you change the action semantics here, update there too, and vice
 *   versa. The future DRY-up is intentional but deferred — see Phase 3b
 *   pre-build notes for why we didn't pull this into a single source of
 *   truth yet. Grep for "SERVER TWIN" / "CLIENT TWIN" to find both files.
 *
 * Scope of writes (each step is a single Supabase insert/upsert):
 *   - groups, columns, column_labels, items, item_column_values.
 * The applier does NOT manage transactions; if step N fails, earlier
 * steps stay committed. Callers can scope this with an SQL transaction
 * via an RPC if atomicity is required (not in 3b).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Action } from './actions-schema.js';
import type { EngineContext } from './gemini-engine.js';

export interface ApplyArgs {
  boardId: string;
  actions: Action[];
  context: EngineContext;       // seeds refMap with real DB ids
  userId: string;               // stored on items.created_by + item_column_values.updated_by
  sb: SupabaseClient;           // injected — service-role for MCP, anon for the client mirror
  onProgress?: (info: { index: number; total: number; description: string }) => void;
}

export interface ApplyResult {
  applied: number;
  failedAt?: { index: number; description: string; error: string };
  // Real db ids that came out of the apply, keyed by AI ref.
  refMap: {
    groups: Record<string, string>;
    columns: Record<string, string>;
    labels: Record<string, string>;
    tasks: Record<string, string>;
  };
}

type CellValue =
  | { value: string | number | boolean }
  | { label_ref: string }
  | { label_refs: string[] }
  | { checked: boolean }
  | { url: string; label?: string };

export async function applyActions(args: ApplyArgs): Promise<ApplyResult> {
  const { boardId, actions, context, userId, sb, onProgress } = args;

  // -------- refMap: seeded from BOARD CONTEXT (real ids the AI saw) ---
  const groupIdByRef:  Record<string, string> = {};
  const columnIdByRef: Record<string, string> = {};
  const labelIdByRef:  Record<string, string> = {};
  const taskIdByRef:   Record<string, string> = {};
  for (const g of context.groups) groupIdByRef[g.ref] = g.id;
  for (const c of context.columns) {
    columnIdByRef[c.ref] = c.id;
    for (const l of c.labels) labelIdByRef[l.ref] = l.id;
  }

  // -------- sort_order counters, fetched once + bumped locally --------
  const { data: existingGroups } = await sb
    .from('groups').select('sort_order').eq('board_id', boardId);
  let nextGroupSort = ((existingGroups ?? []).reduce(
    (m: number, g: { sort_order: number }) => Math.max(m, g.sort_order), -1,
  )) + 1;
  const { data: existingColumns } = await sb
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
    const { data: existing } = await sb
      .from('items').select('sort_order').eq('group_id', groupId);
    const v = ((existing ?? []).reduce(
      (m: number, i: { sort_order: number }) => Math.max(m, i.sort_order), -1,
    )) + 1;
    itemSortByGroup.set(groupId, v);
    return v;
  }
  const labelSortByColumn = new Map<string, number>();
  async function nextLabelSort(columnId: string): Promise<number> {
    if (labelSortByColumn.has(columnId)) {
      const v = labelSortByColumn.get(columnId)! + 1;
      labelSortByColumn.set(columnId, v);
      return v;
    }
    const { data: existing } = await sb
      .from('column_labels').select('sort_order').eq('column_id', columnId);
    const v = ((existing ?? []).reduce(
      (m: number, l: { sort_order: number }) => Math.max(m, l.sort_order), -1,
    )) + 1;
    labelSortByColumn.set(columnId, v);
    return v;
  }

  function resolveColumnId(ref: string): string | null {
    return columnIdByRef[ref] ?? null;
  }

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
      if (columnType === 'date')    return { value: String(value.value) };
      if (columnType === 'numbers') return { value: Number(value.value) };
      return { value: String(value.value) };
    }
    return null;
  }

  // -------- action loop ----------------------------------------------
  for (let i = 0; i < actions.length; i += 1) {
    const a = actions[i];
    const description = describeAction(a);
    onProgress?.({ index: i, total: actions.length, description });
    try {
      switch (a.type) {
        case 'create_group': {
          const { data, error } = await sb
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
          const { data: col, error } = await sb
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

          if (a.labels && a.labels.length > 0) {
            const isLabelType = a.column_type === 'status'
              || a.column_type === 'priority'
              || a.column_type === 'dropdown';
            if (isLabelType) {
              for (const l of a.labels) {
                const sort = await nextLabelSort(colId);
                const { data: lab, error: lErr } = await sb
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
          const { data, error } = await sb
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
          const { data: item, error } = await sb
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

          if (a.cells && Object.keys(a.cells).length > 0) {
            for (const [colRef, raw] of Object.entries(a.cells)) {
              const colId = resolveColumnId(colRef);
              if (!colId) continue;
              const { data: colMeta } = await sb
                .from('columns').select('column_type').eq('id', colId).single();
              const columnType = (colMeta as { column_type?: string } | null)?.column_type ?? 'text';
              const dbValue = translateCell(raw, columnType);
              if (dbValue == null) continue;
              const { error: vErr } = await sb
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
          const itemId  = taskIdByRef[a.task_ref];
          const labelId = labelIdByRef[a.status_ref];
          if (!itemId || !labelId) throw new Error('unknown task_ref or status_ref');
          const { data: statusCols } = await sb
            .from('columns')
            .select('id')
            .eq('board_id', boardId)
            .eq('column_type', 'status')
            .is('archived_at', null)
            .order('sort_order')
            .limit(1);
          const statusColId = (statusCols ?? [])[0]?.id;
          if (!statusColId) throw new Error('no status column on this board');
          const { error } = await sb
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
          const _unreachable: never = a;
          void _unreachable;
        }
      }
    } catch (err) {
      return {
        applied: i,
        failedAt: { index: i, description, error: formatErr(err) },
        refMap: { groups: groupIdByRef, columns: columnIdByRef, labels: labelIdByRef, tasks: taskIdByRef },
      };
    }
  }
  return {
    applied: actions.length,
    refMap: { groups: groupIdByRef, columns: columnIdByRef, labels: labelIdByRef, tasks: taskIdByRef },
  };
}

// ---------- Helpers — mirrors of the client applier's helpers --------
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

function defaultWidthFor(t: string): number {
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
