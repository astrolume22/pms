/**
 * POST /api/ai-build
 *
 * Version B endpoint for the "Build with AI" button. Caller (admin) is
 * authenticated by their Supabase session JWT (Authorization: Bearer
 * <jwt>). We never trust client-provided role claims — we re-fetch the
 * user's row from public.users using the anon client + their JWT, which
 * makes RLS do the auth + role gating for us.
 *
 * Request body:
 *   {
 *     prompt:    string,         // user's natural-language request
 *     kind:      'create_board' | 'add_to_board' | 'add_tasks',
 *     board_id?: string,         // required for add_to_board / add_tasks
 *     model?:    'gemini-2.5-flash' | 'gemini-2.5-pro'
 *   }
 *
 * Response (200):
 *   { actions: [...], notes?: string }
 *
 * Response (4xx/5xx):
 *   { error: string }
 *
 * No DB writes here. The client applier (src/lib/ai-applier.ts) walks
 * the returned actions and applies them via the existing hooks, so all
 * writes flow through the same RLS-protected path as a human admin.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { runEngine, type EngineContext, type EngineKind } from './_shared/gemini-engine';

// Refs we hand back to the model: simple snake_case from the row name +
// short id suffix so two rows with the same name don't collide.
function refFor(prefix: string, name: string, id: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32) || 'x';
  return `${prefix}_${slug}_${id.slice(0, 4)}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS — only same-origin browser calls in production, but explicitly
  // setting the headers makes local dev (vite on 5173, function on
  // localhost via `vercel dev` on 3000) work too.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  if (!apiKey) { res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' }); return; }
  if (!supabaseUrl || !supabaseAnonKey) {
    res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_ANON_KEY not configured on server' });
    return;
  }

  const authHeader = req.headers.authorization ?? '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!jwt) { res.status(401).json({ error: 'missing Authorization: Bearer <token>' }); return; }

  // Authenticated Supabase client — uses the caller's JWT, so every read
  // below is RLS-gated as that user.
  const sb = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  // Identify + role-check the caller.
  const { data: userResp, error: userErr } = await sb.auth.getUser(jwt);
  if (userErr || !userResp?.user) {
    res.status(401).json({ error: 'invalid session token' });
    return;
  }
  const userId = userResp.user.id;
  const { data: profile, error: profileErr } = await sb
    .from('users')
    .select('id, role, is_super_admin, status')
    .eq('id', userId)
    .maybeSingle();
  if (profileErr || !profile) {
    res.status(403).json({ error: 'no profile row for this user' });
    return;
  }
  const isAdmin = profile.role === 'admin' || profile.is_super_admin === true;
  if (!isAdmin) {
    res.status(403).json({ error: 'admin role required' });
    return;
  }
  if (profile.status !== 'active') {
    res.status(403).json({ error: 'account deactivated' });
    return;
  }

  // Parse + validate body.
  const body = (req.body && typeof req.body === 'object') ? req.body as Record<string, unknown> : {};
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const kind = body.kind as EngineKind | undefined;
  const boardId = typeof body.board_id === 'string' ? body.board_id : undefined;
  const model = body.model as 'gemini-2.5-flash' | 'gemini-2.5-pro' | undefined;
  if (!prompt) { res.status(400).json({ error: 'prompt is required' }); return; }
  if (!kind || !['create_board', 'add_to_board', 'add_tasks'].includes(kind)) {
    res.status(400).json({ error: 'kind must be create_board | add_to_board | add_tasks' });
    return;
  }
  if (kind !== 'create_board' && !boardId) {
    res.status(400).json({ error: 'board_id is required for add_to_board / add_tasks' });
    return;
  }
  if (prompt.length > 4000) {
    res.status(400).json({ error: 'prompt too long (max 4000 chars)' });
    return;
  }

  // Build the context snapshot for non-create_board flows.
  const context: EngineContext = { groups: [], columns: [] };
  if (boardId) {
    const { data: board } = await sb.from('boards').select('id, name').eq('id', boardId).maybeSingle();
    if (!board) { res.status(404).json({ error: 'board not found or not accessible' }); return; }
    context.board_id = board.id;
    context.board_name = board.name;

    const [{ data: groups }, { data: columns }] = await Promise.all([
      sb.from('groups').select('id, name, color').eq('board_id', boardId).is('deleted_at', null).order('sort_order'),
      sb.from('columns').select('id, name, column_type').eq('board_id', boardId).is('archived_at', null).order('sort_order'),
    ]);
    context.groups = (groups ?? []).map((g) => ({
      id: g.id, ref: refFor('g', g.name, g.id), name: g.name, color: g.color,
    }));
    const colIds = (columns ?? []).map((c) => c.id);
    let labelsByCol = new Map<string, { id: string; name: string; color: string }[]>();
    if (colIds.length > 0) {
      const { data: labels } = await sb
        .from('column_labels')
        .select('id, column_id, name, color')
        .in('column_id', colIds);
      for (const l of (labels ?? [])) {
        const list = labelsByCol.get(l.column_id) ?? [];
        list.push({ id: l.id, name: l.name, color: l.color });
        labelsByCol.set(l.column_id, list);
      }
    }
    context.columns = (columns ?? []).map((c) => ({
      id: c.id,
      ref: refFor('c', c.name, c.id),
      name: c.name,
      column_type: c.column_type,
      labels: (labelsByCol.get(c.id) ?? []).map((l) => ({
        id: l.id, ref: refFor('l', l.name, l.id), name: l.name, color: l.color,
      })),
    }));
  }

  // Run the engine — short request/response, no polling.
  const result = await runEngine({ apiKey, prompt, kind, context, model });
  if (!result.ok) {
    res.status(502).json({ error: result.error });
    return;
  }

  // Log to ai_runs (best-effort — don't fail the request if logging fails).
  void sb.from('ai_runs').insert({
    user_id: userId,
    feature: kind,
    prompt,
    model: model ?? 'gemini-2.5-flash',
    status: 'success',
    response: JSON.stringify(result.data).slice(0, 8000),
    target_type: boardId ? 'board' : null,
    target_id: boardId ?? null,
  } as never);

  res.status(200).json({ ...result.data, context });
}
