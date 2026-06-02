/**
 * POST /api/create-task-from-notes
 *
 * Write bridge for the Meeting Intelligence app. Creates ONE task in a
 * caller-chosen group on the Tessera board and (optionally) posts the
 * call-notes/summary text as the task's first Update.
 *
 * Why a dedicated endpoint and not the MCP bridge:
 *   • MCP_BEARER grants every write tool (delete_board, create_workspace,
 *     etc.). Shipping it to a browser would leak the whole workspace.
 *   • create_task in MCP has NO body field — meeting notes would need two
 *     calls (create_task + add_task_update). One round-trip from this
 *     endpoint is simpler and matches the meeting flow.
 *   • EIA_BRIDGE_KEY is the same shared secret already powering
 *     api/list-groups.ts. Same auth model, same CORS allow-list, no new
 *     secret to rotate.
 *
 * Auth: caller MUST send  x-eia-key: <EIA_BRIDGE_KEY>  matching the
 * server env var. Wrong / missing → 401.
 *
 * Tenancy: hard-pinned to TESSERA_BOARD_ID. The group_id from the
 * request is verified to belong to that board (and not be soft-deleted)
 * BEFORE the insert. Even though service-role bypasses RLS, the
 * board-pin + group lookup is the multi-tenant guard.
 *
 * Body shape:
 *   { group_id: uuid, name: string (1-200), body?: string (≤20000) }
 *
 * Success:
 *   200 { ok: true, task_id, task_code, update_id?: string }
 * Errors:
 *   400 { ok: false, error: '<validation message>' }
 *   401 { ok: false, error: 'Unauthorized' }
 *   405 { ok: false, error: 'Only POST is supported on this endpoint' }
 *   500 { ok: false, error: '<message>' }
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Tessera main board — same pin as list-groups.ts. Hard-coded so this
// endpoint can never accidentally write into another workspace, even if
// service-role + RLS bypass + a malformed group_id slipped through.
const TESSERA_BOARD_ID = '28472783-6d7a-4de9-8834-2354f62856c5';

// Origins allowed to call this endpoint cross-site. Keep in sync with
// api/list-groups.ts — both endpoints together form the Meeting
// Intelligence bridge so they must share the same allow-list.
const STATIC_ALLOWED_ORIGINS = new Set<string>([
  'https://jobs.expertintuitiveadvisor.com',
  'https://meeting-inteligence.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
]);
const ALLOWED_ORIGIN_SUFFIXES = ['.lovable.app', '.lovable.dev'];

function isAllowedOrigin(origin: string | undefined): origin is string {
  if (!origin) return false;
  if (STATIC_ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const host = new URL(origin).hostname;
    return ALLOWED_ORIGIN_SUFFIXES.some((suf) => host === suf.slice(1) || host.endsWith(suf));
  } catch {
    return false;
  }
}

function applyCors(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin;
  const originHeader = Array.isArray(origin) ? origin[0] : origin;
  if (isAllowedOrigin(originHeader)) {
    res.setHeader('Access-Control-Allow-Origin', originHeader);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-eia-key');
  res.setHeader('Access-Control-Max-Age', '600');
}

// Constant-time string compare — mirrors api/list-groups.ts + api/mcp.ts.
// Avoids the early-exit timing leak of `===` on a shared secret.
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) {
    let acc = 1;
    for (let i = 0; i < a.length; i += 1) acc |= a.charCodeAt(i) ^ 0;
    return acc === 0;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// HTML-escape — same character set used by api/mcp.ts's escapeHtml so
// plain-text bodies posted here render identically to bodies posted via
// add_task_update.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Resolve a stable system actor for created_by / author_id — first
// active admin by creation date. Identical heuristic to MCP's
// getServiceActorId(); duplicated standalone so this endpoint has no
// cross-file dependency on api/mcp.ts.
let serviceActorIdCache: string | null = null;
async function getServiceActorId(sb: SupabaseClient): Promise<string> {
  if (serviceActorIdCache) return serviceActorIdCache;
  const { data, error } = await sb
    .from('users')
    .select('id')
    .eq('role', 'admin')
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`could not resolve service actor: ${error.message}`);
  if (!data) throw new Error('no active admin user available as service actor');
  serviceActorIdCache = (data as { id: string }).id;
  return serviceActorIdCache;
}

interface RequestBody {
  group_id?: unknown;
  name?: unknown;
  body?: unknown;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Only POST is supported on this endpoint' });
    return;
  }

  try {
    // ---- env / config --------------------------------------------------
    const expectedKey = process.env.EIA_BRIDGE_KEY;
    if (!expectedKey) {
      res.status(500).json({ ok: false, error: 'EIA_BRIDGE_KEY not configured on server' });
      return;
    }
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      res.status(500).json({ ok: false, error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured on server' });
      return;
    }

    // ---- auth ----------------------------------------------------------
    const raw = req.headers['x-eia-key'];
    const presented = Array.isArray(raw) ? raw[0] : raw;
    if (!presented || !constantTimeEquals(presented, expectedKey)) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }

    // ---- parse + validate body ----------------------------------------
    // Vercel parses JSON for application/json automatically; if the
    // caller forgot the Content-Type we tolerate a string and parse.
    let body: RequestBody;
    if (typeof req.body === 'string') {
      try { body = JSON.parse(req.body) as RequestBody; }
      catch { res.status(400).json({ ok: false, error: 'Request body is not valid JSON' }); return; }
    } else if (req.body && typeof req.body === 'object') {
      body = req.body as RequestBody;
    } else {
      res.status(400).json({ ok: false, error: 'Request body is required' });
      return;
    }

    const groupId = typeof body.group_id === 'string' ? body.group_id.trim() : '';
    if (!groupId || !UUID_RE.test(groupId)) {
      res.status(400).json({ ok: false, error: 'group_id must be a UUID' });
      return;
    }

    const rawName = typeof body.name === 'string' ? body.name : '';
    const name = rawName.trim();
    if (name.length < 1) {
      res.status(400).json({ ok: false, error: 'name is required (1-200 chars)' });
      return;
    }
    if (name.length > 200) {
      res.status(400).json({ ok: false, error: 'name must be 200 chars or fewer' });
      return;
    }

    let updateBody: string | null = null;
    if (typeof body.body === 'string' && body.body.trim().length > 0) {
      if (body.body.length > 20000) {
        res.status(400).json({ ok: false, error: 'body must be 20000 chars or fewer' });
        return;
      }
      updateBody = body.body;
    }

    // ---- DB client (service-role, RLS bypassed; board-pin guards it) ---
    const sb = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ---- verify group belongs to Tessera + not soft-deleted -----------
    const { data: groupRow, error: groupErr } = await sb
      .from('groups')
      .select('id, board_id, deleted_at')
      .eq('id', groupId)
      .maybeSingle();
    if (groupErr) {
      res.status(500).json({ ok: false, error: `group lookup failed: ${groupErr.message}` });
      return;
    }
    const g = groupRow as { id?: string; board_id?: string; deleted_at?: string | null } | null;
    if (!g || g.deleted_at) {
      res.status(400).json({ ok: false, error: 'group_id not found' });
      return;
    }
    if (g.board_id !== TESSERA_BOARD_ID) {
      // Defensive: refuse to write into any group that's not on Tessera,
      // even though the board_id we pass to the insert is hard-coded.
      // The mismatch means the caller asked for a foreign workspace.
      res.status(400).json({ ok: false, error: 'group does not belong to the Tessera board' });
      return;
    }

    // ---- insert the task ----------------------------------------------
    // task_code = '' so the before_item_insert trigger (migration 0047)
    // fills it with the self-healing "Task N" counter. Single-row insert.
    const actor = await getServiceActorId(sb);
    const insertPayload = {
      board_id: TESSERA_BOARD_ID,
      group_id: groupId,
      name,
      task_code: '',
      created_by: actor,
    };
    const { data: itemRow, error: itemErr } = await sb
      .from('items')
      .insert(insertPayload as never)
      .select('id, name, task_code')
      .single();
    if (itemErr) {
      res.status(500).json({ ok: false, error: `item insert failed: ${itemErr.message}` });
      return;
    }
    const item = itemRow as { id: string; name: string; task_code: string };

    // ---- optionally post the call-notes body as an update -------------
    // Mirrors add_task_update in api/mcp.ts: plain text gets wrapped in
    // <p>…</p> (with the same escapeHtml chain) and body_json stays null.
    // The UI renders updates.body_html through DOMPurify on read.
    let updateId: string | null = null;
    if (updateBody) {
      const bodyHtml = `<p>${escapeHtml(updateBody)}</p>`;
      const { data: updRow, error: updErr } = await sb
        .from('updates')
        .insert({
          item_id: item.id,
          author_id: actor,
          body_html: bodyHtml,
          body_json: null,
        } as never)
        .select('id')
        .single();
      if (updErr) {
        // The task is already created — surface a partial-success error
        // so the caller can decide whether to retry the body. Returning
        // 200 here would hide the failure; returning 500 + task_id lets
        // them act on both signals.
        res.status(500).json({
          ok: false,
          error: `task created (id=${item.id}, code=${item.task_code}) but updates insert failed: ${updErr.message}`,
        });
        return;
      }
      updateId = (updRow as { id: string }).id;
    }

    const responseBody: { ok: true; task_id: string; task_code: string; update_id?: string } = {
      ok: true,
      task_id: item.id,
      task_code: item.task_code,
    };
    if (updateId) responseBody.update_id = updateId;
    res.status(200).json(responseBody);
  } catch (e) {
    const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error('[create-task-from-notes] handler threw:', e);
    res.status(500).json({ ok: false, error: message });
  }
}
