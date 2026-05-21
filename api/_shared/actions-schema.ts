/**
 * Zod schema for the "Build with AI" actions JSON. Shared by:
 *   - api/_shared/gemini-engine.ts (validates Gemini output server-side)
 *   - src/lib/ai-applier.ts        (replays the actions client-side)
 *
 * Refs are temp ids valid ONLY within one batch — they let later actions
 * reference earlier ones before the rows have real DB ids. The applier
 * maintains a refMap keyed by ref name as it walks the action list.
 *
 * Column-type values follow public.columns.column_type in the DB:
 *   task_name | text | status | people | date | priority |
 *   numbers | checkbox | dropdown | link  (no task_name from AI — it's
 *   auto-seeded on board create, so we reject task_name from AI actions).
 */
import { z } from 'zod';

const RefName = z.string().regex(/^[a-z_][a-z0-9_]*$/i, 'ref must be a simple identifier');

const CellValue = z.union([
  z.object({ value: z.union([z.string(), z.number(), z.boolean()]) }),
  z.object({ label_ref: RefName }),                                    // status / priority single-select
  z.object({ label_refs: z.array(RefName) }),                          // dropdown multi-select
  z.object({ checked: z.boolean() }),
  z.object({ url: z.string().url(), label: z.string().optional() }),
]);

const ColumnTypeForCreate = z.enum([
  'text', 'status', 'people', 'date', 'priority',
  'numbers', 'checkbox', 'dropdown', 'link',
]);

const HexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'color must be a #RRGGBB hex');

export const CreateGroupAction = z.object({
  type: z.literal('create_group'),
  ref: RefName.optional(),
  name: z.string().min(1).max(80),
  color: HexColor.optional(),
});

export const CreateColumnAction = z.object({
  type: z.literal('create_column'),
  ref: RefName.optional(),
  column_type: ColumnTypeForCreate,
  name: z.string().min(1).max(80),
  // Inline label seeds — convenience for status/priority/dropdown so the
  // AI doesn't have to emit a column + a flurry of create_label actions
  // back-to-back. Each gets its own ref so create_task can point at it.
  labels: z.array(z.object({
    ref: RefName.optional(),
    name: z.string().min(1).max(40),
    color: HexColor,
  })).optional(),
});

export const CreateLabelAction = z.object({
  type: z.literal('create_label'),
  ref: RefName.optional(),
  column_ref: RefName,
  name: z.string().min(1).max(40),
  color: HexColor,
});

export const CreateTaskAction = z.object({
  type: z.literal('create_task'),
  ref: RefName.optional(),
  group_ref: RefName,
  name: z.string().min(1).max(200),
  cells: z.record(RefName, CellValue).optional(),
});

export const UpdateTaskStatusAction = z.object({
  type: z.literal('update_task_status'),
  task_ref: RefName,
  status_ref: RefName,
});

export const Action = z.discriminatedUnion('type', [
  CreateGroupAction,
  CreateColumnAction,
  CreateLabelAction,
  CreateTaskAction,
  UpdateTaskStatusAction,
]);

export const EngineResponse = z.object({
  actions: z.array(Action).min(1).max(200),
  notes: z.string().optional(),
});

export type Action = z.infer<typeof Action>;
export type EngineResponse = z.infer<typeof EngineResponse>;
export type CellValueT = z.infer<typeof CellValue>;
