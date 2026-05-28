/**
 * GET /api/list-groups
 *
 * Read-only bridge endpoint for the EIA app. Returns the live list of
 * non-deleted groups on the main Tessera board so EIA can populate a
 * dropdown ("which group does this go to?") without having to bake in
 * board state or call Supabase directly.
 *
 * Auth: caller MUST send  x-eia-key: <EIA_BRIDGE_KEY>  matching the
 * server env var. Wrong / missing → 401. The key is a long random
 * shared secret; rotatable via Vercel env in seconds.
 *
 * Tenancy: this endpoint authenticates with the Supabase SERVICE_ROLE
 * key (same pattern as api/mcp). RLS is bypassed, but the query is
 * pinned to a SINGLE hard-coded board_id (Tessera) so no other
 * workspace can ever surface here. There are no writes.
 *
 * CORS: explicit allow-list. The standard "Allow-Origin: *" plus a
 * custom header is enough today but echoing the matched origin keeps
 * the door open for future credentialed calls and is the safer default.
 *
 * Shape:
 *   200 { "ok": true,  "groups": [ { "id", "name", "color" }, ... ] }
 *   401 { "ok": false, "error": "Unauthorized" }
 *   500 { "ok": false, "error": "<message>" }
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// Tessera main board on workspace 88b55336-… — locked here on purpose
// so this endpoint can never accidentally leak a different workspace's
// groups, even if RLS is bypassed.
const TESSERA_BOARD_ID = '28472783-6d7a-4de9-8834-2354f62856c5';

// Origins allowed to call this endpoint cross-site. Anything not on
// this list gets no Access-Control-Allow-Origin header back, so the
// browser blocks the response.
const STATIC_ALLOWED_ORIGINS = new Set<string>([
  'https://jobs.expertintuitiveadvisor.com',
  'http://localhost:5173',
  'http://localhost:3000',
]);

// Lovable preview origins are dynamic (one per project). Match by
// suffix so we don't have to know them in advance.
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-eia-key');
  res.setHeader('Access-Control-Max-Age', '600');
}

// Constant-time string compare — same shape as the helper in api/mcp.ts.
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res);

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Only GET is supported on this endpoint' });
    return;
  }

  try {
    // ---- env / config --------------------------------------------------
    const expectedKey = process.env.EIA_BRIDGE_KEY;
    if (!expectedKey) {
      res.status(500).json({ ok: false, error: 'EIA_BRIDGE_KEY not configured on server' });
      return;
    }
    const supabaseUrl =
      process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
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

    // ---- query ---------------------------------------------------------
    // Service-role client; RLS bypassed. The board_id filter is the
    // multi-tenant guard for this endpoint.
    const sb = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await sb
      .from('groups')
      .select('id, name, color')
      .eq('board_id', TESSERA_BOARD_ID)
      .is('deleted_at', null)
      .order('sort_order', { ascending: true });
    if (error) {
      res.status(500).json({ ok: false, error: error.message });
      return;
    }

    res.status(200).json({
      ok: true,
      groups: (data ?? []).map((g) => ({
        id: g.id,
        name: g.name,
        color: g.color ?? null,
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error('[list-groups] handler threw:', e);
    res.status(500).json({ ok: false, error: message });
  }
}
