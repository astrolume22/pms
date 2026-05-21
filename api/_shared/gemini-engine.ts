/**
 * Shared "Build with AI" engine. Pure function — no DB I/O, no auth.
 * Auth + DB context-fetching happens in the caller (api/ai-build.ts for
 * Version B; api/mcp.ts in Phase 3).
 *
 * Inputs:
 *   - prompt  — user's natural-language request
 *   - kind    — what they're trying to do ('create_board' | 'add_to_board'
 *               | 'add_tasks'); only changes the system prompt's framing
 *   - context — the current board snapshot (groups + columns + labels)
 *               so the AI doesn't invent column ids that already exist.
 *               For kind='create_board' callers should pass an empty
 *               context object.
 *
 * Output:
 *   { actions: [...] } on success (Zod-validated), or { error: string }
 *   on failure (Gemini error, model returned non-JSON, validation
 *   failed, etc).
 */
import { EngineResponse, type EngineResponse as EngineResponseT } from './actions-schema';

export type EngineKind = 'create_board' | 'add_to_board' | 'add_tasks';

export interface EngineContextLabel {
  id: string;            // real DB id — engine returns this directly as label_id; applier passes through
  ref: string;           // synthetic ref name shaped from the label name so the model can use it
  name: string;
  color: string;
}
export interface EngineContextColumn {
  id: string;
  ref: string;
  name: string;
  column_type: string;
  labels: EngineContextLabel[];
}
export interface EngineContextGroup {
  id: string;
  ref: string;
  name: string;
  color: string;
}
export interface EngineContext {
  board_id?: string;
  board_name?: string;
  groups: EngineContextGroup[];
  columns: EngineContextColumn[];
}

export interface RunEngineArgs {
  prompt: string;
  kind: EngineKind;
  context: EngineContext;
  // Optional per-call override; defaults to gemini-2.5-flash.
  model?: 'gemini-2.5-flash' | 'gemini-2.5-pro';
}

export type RunEngineResult =
  | { ok: true; data: EngineResponseT }
  | { ok: false; error: string };

const DEFAULT_MODEL = 'gemini-2.5-flash';

// ---------------------------------------------------------------------
// System prompt — built fresh per call so the existing board context is
// inlined. Kept compact: every token costs latency.
// ---------------------------------------------------------------------
function buildSystemPrompt(kind: EngineKind, context: EngineContext): string {
  const ctxLines: string[] = [];
  if (context.board_name) ctxLines.push(`Current board: "${context.board_name}"`);
  if (context.groups.length > 0) {
    ctxLines.push('Existing groups (use these refs if adding to them):');
    for (const g of context.groups) ctxLines.push(`  - ref="${g.ref}" name="${g.name}"`);
  }
  if (context.columns.length > 0) {
    ctxLines.push('Existing columns:');
    for (const c of context.columns) {
      const labelInfo = c.labels.length > 0
        ? ` labels=[${c.labels.map((l) => `${l.ref}:"${l.name}"`).join(', ')}]`
        : '';
      ctxLines.push(`  - ref="${c.ref}" name="${c.name}" type=${c.column_type}${labelInfo}`);
    }
  }
  const ctxBlock = ctxLines.length > 0 ? `\nBOARD CONTEXT:\n${ctxLines.join('\n')}\n` : '';

  return `You design project-management boards for an internal team tool ("PMS"). You speak ONLY in a strict JSON object — no prose, no markdown fences, no explanation outside the JSON.

OUTPUT SHAPE:
{
  "actions": [ ... ],
  "notes": "optional short summary"
}

Each action is one of (discriminated by "type"):

1. create_group
   { "type": "create_group", "ref": "<lower_snake_id>", "name": "<group title>", "color": "#RRGGBB"? }

2. create_column  (do NOT create task_name — that's auto-seeded by the system)
   { "type": "create_column", "ref": "<id>", "column_type": "text|status|people|date|priority|numbers|checkbox|dropdown|link", "name": "<column title>",
     "labels": [{ "ref": "<id>", "name": "<label>", "color": "#RRGGBB" }, ...]?  // ONLY for status / priority / dropdown columns
   }

3. create_label   (use this only to add labels to a column AFTER the column was created earlier OR was already present in BOARD CONTEXT)
   { "type": "create_label", "ref": "<id>", "column_ref": "<column ref>", "name": "<label>", "color": "#RRGGBB" }

4. create_task
   { "type": "create_task", "ref": "<id>", "group_ref": "<group ref>", "name": "<task title>",
     "cells": {
       "<column_ref>": <cell-value>   // optional, key is the column's ref
     }?
   }

5. update_task_status
   { "type": "update_task_status", "task_ref": "<task ref>", "status_ref": "<label ref>" }

CELL VALUE shapes (the "<cell-value>" placeholder above):
   - text       column → { "value": "<text>" }
   - status     column → { "label_ref": "<label ref>" }            (single)
   - priority   column → { "label_ref": "<label ref>" }            (single)
   - dropdown   column → { "label_refs": ["<label ref>", ...] }    (multi)
   - date       column → { "value": "YYYY-MM-DD" }
   - numbers    column → { "value": 42 }
   - checkbox   column → { "checked": true|false }
   - link       column → { "url": "https://...", "label": "<text>"? }
   - people column: omit — assignees are picked manually post-build.

HARD RULES:
- Every value with a "label_ref" / "label_refs" / "status_ref" MUST reference either (a) a label declared inline in a create_column.labels array, (b) a label created via create_label, or (c) a label from BOARD CONTEXT above. Inventing label refs that don't exist is forbidden.
- Every "group_ref" must reference either a create_group earlier in the same batch OR a group from BOARD CONTEXT.
- Every "column_ref" must reference either a create_column earlier in the same batch OR a column from BOARD CONTEXT.
- Refs are lower_snake_case ids unique within this batch. Pick meaningful ones (e.g. "g_discovery", "c_status", "l_done", "t_kickoff").
- Colors are #RRGGBB hex (6-digit). For status labels prefer this Monday-night palette: Done=#4CD297, "In progress"/"Working on it"=#FDBB71, "Not started"=#777E91, Paused/Stuck=#E16E7F, "Need Help"=#419DCC. For priority use a purple ramp: High=#6646A7, Medium=#51458F, Low=#3E3A6B. Otherwise pick from {#F8BD6D, #D0728A, #33C481, #3DA0CA, #B17FE0, #FF3D8B, #F74EA1, #7DAFF8, #71BCA5}.
- Stay under 60 actions total. Prefer 4-6 groups and 3-5 tasks per group for a new board.
- If the user just wants tasks added to an existing group, only emit create_task actions referencing the existing group_ref from BOARD CONTEXT.

KIND HINT: ${kind === 'create_board'
    ? 'The user is designing a NEW BOARD. Start with create_group / create_column, then create_task. A status column is almost always wanted.'
    : kind === 'add_to_board'
      ? 'The user is EXTENDING the existing board. Reference existing groups/columns from BOARD CONTEXT where possible; only create new ones if the user explicitly asks.'
      : 'The user is ADDING TASKS to a group. Emit only create_task actions referencing existing groups/columns from BOARD CONTEXT.'}
${ctxBlock}
Return ONLY the JSON object. No code fences, no preamble.`;
}

// ---------------------------------------------------------------------
// Gemini call — uses generateContent with responseMimeType: application/json
// so the model is forced into a JSON-only output stream.
// ---------------------------------------------------------------------
async function callGemini(args: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${args.model}:generateContent?key=${encodeURIComponent(args.apiKey)}`;

  // Per Gemini docs, system_instruction is a top-level field. We also
  // set generationConfig.responseMimeType to lock to JSON.
  const body = {
    system_instruction: { parts: [{ text: args.systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: args.userPrompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
    },
  };

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, error: `network: ${err instanceof Error ? err.message : String(err)}` };
  }

  const raw = await resp.text();
  if (!resp.ok) {
    return { ok: false, error: `gemini http ${resp.status}: ${raw.slice(0, 400)}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'gemini returned non-JSON envelope' };
  }
  const text = (parsed as { candidates?: { content?: { parts?: { text?: string }[] } }[] })
    .candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    return { ok: false, error: 'gemini envelope had no text part' };
  }
  return { ok: true, text };
}

// ---------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------
export async function runEngine(args: RunEngineArgs & { apiKey: string }): Promise<RunEngineResult> {
  const { prompt, kind, context, apiKey } = args;
  if (!apiKey) return { ok: false, error: 'GEMINI_API_KEY not configured' };
  if (!prompt || prompt.trim().length === 0) {
    return { ok: false, error: 'prompt is empty' };
  }

  const systemPrompt = buildSystemPrompt(kind, context);
  const model = args.model ?? DEFAULT_MODEL;

  const result = await callGemini({ apiKey, model, systemPrompt, userPrompt: prompt });
  if (!result.ok) return { ok: false, error: result.error };

  // Strip any accidental code fences / leading prose just in case.
  const cleaned = result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(cleaned);
  } catch {
    return { ok: false, error: 'gemini text was not JSON: ' + cleaned.slice(0, 200) };
  }

  const validated = EngineResponse.safeParse(parsedJson);
  if (!validated.success) {
    return {
      ok: false,
      error: 'engine output failed schema validation: ' + validated.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join(' | '),
    };
  }

  return { ok: true, data: validated.data };
}
