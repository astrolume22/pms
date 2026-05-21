# AI Engine — Actions JSON Schema (Phase 1)

This is the contract between Gemini (the "Build with AI" engine) and
the PMS applier. The engine writes JSON in this shape; the applier
walks it action-by-action and translates each one into an existing
Supabase write (`useCreateGroup`, `useCreateColumn`, `useCreateLabel`,
`useCreateItem`, `useUpdateCellValue`). No new tables, no new RPCs.

The system prompt enforcing this shape lives in
`api/_shared/gemini-engine.ts`; the runtime Zod validator lives in
`api/_shared/actions-schema.ts`. Keep this doc in sync with those two
files whenever you change the contract.

---

## Top-level envelope

```json
{
  "actions": [ ...one or more action objects... ],
  "notes": "optional short summary of what was planned"
}
```

Validation:
- `actions.length` must be between 1 and 200.
- `notes` is optional and only shown to the admin in the Preview screen.

---

## Refs

Each action can declare a `ref` — a lowercase-snake-case id like
`g_discovery`, `c_status`, `l_done`. Later actions reference those refs
(`group_ref`, `column_ref`, `label_ref`, `task_ref`, `status_ref`).
Refs are valid **only within one batch**; the applier resolves them to
real DB ids as each row is created.

The applier also primes the ref-map with the engine's BOARD CONTEXT
(every existing group / column / label gets a synthetic ref the model
can use), so actions can reference rows that already existed before
this AI build.

Ref grammar: `[a-z_][a-z0-9_]*`, case-insensitive at the regex level
but conventionally lowercase.

---

## Action types

### 1. `create_group`

```json
{
  "type": "create_group",
  "ref": "g_discovery",
  "name": "Discovery",
  "color": "#FF3D8B"
}
```

- `name` required, 1–80 chars.
- `color` optional, `#RRGGBB`. Defaults to the group accent palette.

### 2. `create_column`

```json
{
  "type": "create_column",
  "ref": "c_status",
  "column_type": "status",
  "name": "Status",
  "labels": [
    { "ref": "l_not_started",   "name": "Not Started",   "color": "#777E91" },
    { "ref": "l_working",       "name": "Working on it", "color": "#FDBB71" },
    { "ref": "l_done",          "name": "Done",          "color": "#4CD297" }
  ]
}
```

- `column_type` must be one of: `text`, `status`, `people`, `date`,
  `priority`, `numbers`, `checkbox`, `dropdown`, `link`.
  `task_name` is NOT mintable from AI — every board already has one
  auto-seeded by the boards trigger.
- `labels[]` is only honored for `status` / `priority` / `dropdown`
  columns. For everything else it's ignored.
- The applier picks a sensible default `width` per column type.

### 3. `create_label`

For adding labels to a column that was already created earlier in the
same batch OR was already present in BOARD CONTEXT:

```json
{
  "type": "create_label",
  "ref": "l_stuck",
  "column_ref": "c_status",
  "name": "Stuck",
  "color": "#E16E7F"
}
```

If you're creating the column AND its labels together, prefer the
inline `labels: [...]` array on `create_column` — fewer round-trips,
same result.

### 4. `create_task`

```json
{
  "type": "create_task",
  "ref": "t_kickoff",
  "group_ref": "g_discovery",
  "name": "Kickoff meeting with stakeholders",
  "cells": {
    "c_status":   { "label_ref": "l_done" },
    "c_priority": { "label_ref": "l_high" },
    "c_date":     { "value": "2026-06-01" },
    "c_notes":    { "value": "Recurring weekly" }
  }
}
```

`cells` is keyed by column ref. Per cell value shape (matches the DB):

| Column type | Cell value |
|---|---|
| `text`     | `{ "value": "<string>" }` |
| `status`   | `{ "label_ref": "<label ref>" }` (single) |
| `priority` | `{ "label_ref": "<label ref>" }` (single) |
| `dropdown` | `{ "label_refs": ["<label ref>", ...] }` (multi) |
| `date`     | `{ "value": "YYYY-MM-DD" }` |
| `numbers`  | `{ "value": 42 }` |
| `checkbox` | `{ "checked": true }` |
| `link`     | `{ "url": "https://...", "label": "<optional>" }` |
| `people`   | omit — assignees are picked manually after the build |

`label_ref` / `label_refs` must reference a label that exists in BOARD
CONTEXT or was created earlier in this batch.

### 5. `update_task_status`

```json
{
  "type": "update_task_status",
  "task_ref": "t_kickoff",
  "status_ref": "l_done"
}
```

Convenience shortcut. The applier writes to the **first** status
column on the board (V1 assumes one status column per board).

---

## Hard rules

1. **No invented refs.** Every `*_ref` must resolve to either an
   earlier-in-batch action or a row from BOARD CONTEXT. The Zod
   validator can't catch this — the applier does, and surfaces the
   error in the Preview / Apply step.
2. **Colors are `#RRGGBB` hex** (6 digits). The system prompt nudges
   the model toward our Monday-night palette.
3. **task_name columns are forbidden.** Every board already has one.
4. **Stay under 60 actions per batch.** Soft confirm fires at 20+.
   Hard cap is 200 (Zod-enforced).
5. **`people` cells are never set by AI** — the model doesn't know
   which usernames exist, and we don't want it guessing.

---

## Example prompts

### A. New board from scratch
> "Build a Shopify launch board: Discovery, Build, QA, Launch — each
> phase as a group with 3-4 tasks. Add a Status column with Not Started
> / Working on it / Done. Add a Priority column with High / Medium / Low."

Expected output (abridged):
- 4 × `create_group`
- 1 × `create_column` (status, with 3 inline labels)
- 1 × `create_column` (priority, with 3 inline labels)
- 13 × `create_task` (some with `cells: { c_status: { label_ref: ... } }`)

### B. Add tasks to an existing group
> "Add 5 testing tasks to the QA group: regression, e2e, accessibility,
> performance, security review."

Expected output (only):
- 5 × `create_task` (each `group_ref: g_qa` from BOARD CONTEXT)

### C. Bulk status update
> "Mark all tasks in the Discovery group as Done."

Expected output:
- N × `update_task_status` (one per task already in BOARD CONTEXT)

---

## Where this is used

- **Version B (Phase 1, shipped):** the ✨ "Build with AI" button on
  every board's header. Admin pastes a prompt, previews the plan,
  applies via the client applier.
- **Version A (Phase 3, planned):** the MCP connector exposes the
  same engine to Optimus directly. He drafts and builds in one chat
  step. The actions JSON contract is the same — only the trigger
  surface differs.
