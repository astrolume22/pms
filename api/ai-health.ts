/**
 * GET /api/ai-health
 *
 * Lightweight health check for the new "Build with AI" engine. Used by
 * the /admin AI status block. Admin-only — same Bearer-JWT + role-check
 * pattern as /api/ai-build, so a manager hitting this directly gets a
 * 403 even though the JWT is valid.
 *
 * Response (200):
 *   {
 *     ok:      boolean,            // true ⇔ has_key && supabase env present
 *     has_key: boolean,            // GEMINI_API_KEY is set on the server
 *     model:   'gemini-2.5-flash', // default model the engine uses
 *     env:     {
 *       supabase_url: boolean,
 *       supabase_anon_key: boolean
 *     }
 *   }
 *
 * The key VALUE is never returned — only its presence as a boolean.
 *
 * Response (401/403/405/500):
 *   { error: string }
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS — match /api/ai-build so vite dev (5173) → vercel dev (3000) works.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  try {
    const supabaseUrl    = process.env.SUPABASE_URL      ?? process.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_ANON_KEY not configured on server' });
      return;
    }

    const authHeader = req.headers.authorization ?? '';
    const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!jwt) { res.status(401).json({ error: 'missing Authorization: Bearer <token>' }); return; }

    // Identify + role-check the caller using their JWT (RLS-gated).
    const sb = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userResp, error: userErr } = await sb.auth.getUser(jwt);
    if (userErr || !userResp?.user) {
      res.status(401).json({ error: 'invalid session token' });
      return;
    }
    const { data: profile, error: profileErr } = await sb
      .from('users')
      .select('id, role, is_super_admin, status')
      .eq('id', userResp.user.id)
      .maybeSingle();
    if (profileErr || !profile) {
      res.status(403).json({ error: 'no profile row for this user' });
      return;
    }
    const isAdmin = profile.role === 'admin' || profile.is_super_admin === true;
    if (!isAdmin)                   { res.status(403).json({ error: 'admin role required' }); return; }
    if (profile.status !== 'active'){ res.status(403).json({ error: 'account deactivated' }); return; }

    const apiKey = process.env.GEMINI_API_KEY ?? '';
    const hasKey = apiKey.trim().length > 0;

    res.status(200).json({
      ok:      hasKey,
      has_key: hasKey,
      model:   'gemini-2.5-flash',
      env: {
        supabase_url:      Boolean(supabaseUrl),
        supabase_anon_key: Boolean(supabaseAnonKey),
      },
    });
  } catch (err) {
    const message = err instanceof Error
      ? `${err.name}: ${err.message}`
      : typeof err === 'string' ? err : 'unknown error';
    console.error('[ai-health] handler threw:', err);
    res.status(500).json({ error: 'internal: ' + message });
  }
}
