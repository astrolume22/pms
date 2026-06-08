/**
 * src/lib/db.ts — direct PostgREST helper for the board data layer.
 *
 * WHY:
 *   supabase.from()/.rpc()/storage calls go through @supabase/supabase-js's
 *   fetchWithAuth, which awaits supabase.auth.getSession() BEFORE every
 *   HTTP request to build the Authorization header. After a tab refocus,
 *   that get-session/lock path was the proven funnel jam: every board
 *   fetch queued before it ever reached timeoutFetch and the Network
 *   tab showed zero requests.
 *
 *   We can't pass the supabase-js top-level `accessToken` option to skip
 *   that — in 2.106.0 (index.cjs:630-637) it REPLACES supabase.auth with
 *   a Proxy that throws on every property access, killing login /
 *   invite-accept / refreshSession / onAuthStateChange.
 *
 *   So this module skips supabase-js entirely for board data: it calls
 *   PostgREST URLs directly through the shared timeoutFetch (the same
 *   [fetch #N] funnel + 6s timeout + refresh-on-401 retry), and reads
 *   the cached access token from supabase.ts (seeded at boot,
 *   refreshed by onAuthStateChange + the 401-retry path).
 *
 * SCOPE:
 *   ONLY board-layer hooks (boards / items / groups / columns / views /
 *   labels). Shift / admin / notifications / invites / ai hooks keep
 *   using supabase.from() — they're not on the refocus-wedge path the
 *   founder reported.
 */
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  getCachedAccessToken,
  timeoutFetch,
} from './supabase';

const REST_BASE = `${SUPABASE_URL}/rest/v1`;

// =====================================================================
// PostgREST filter & order helpers.
//
// Values that go into the URL must already be PostgREST-formatted, e.g.
// `eq.123`, `is.null`, `in.(a,b,c)`. These helpers produce the right
// suffix; call sites assemble the filters object: { id: eq(uuid),
// deleted_at: isNull }.
// =====================================================================
export function eq(v: string | number | boolean | null): string {
  if (v === null) return 'is.null';
  return 'eq.' + encodeURIComponent(String(v));
}
export const isNull = 'is.null';
export function inSet(values: ReadonlyArray<string | number>): string {
  // PostgREST in operator: in.(a,b,c). UUIDs / ints don't need quoting;
  // anything with commas, parens, or quotes does.
  const items = values.map((v) => {
    const s = String(v);
    return /[,()"\s]/.test(s) ? '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"' : s;
  });
  return 'in.(' + items.join(',') + ')';
}

export type Filters = Record<string, string>;
export interface SelectOpts {
  select?: string;        // default '*'
  filters?: Filters;      // values must include PostgREST operator: 'eq.X', 'is.null', etc.
  order?: string;         // 'col.asc' / 'col.desc' / 'col.asc.nullslast'
  limit?: number;
}

function buildSelectQS(opts: SelectOpts): string {
  const parts: string[] = [];
  // `select` value: commas + dots OK as-is per PostgREST docs.
  parts.push('select=' + (opts.select ?? '*'));
  if (opts.filters) {
    for (const [k, v] of Object.entries(opts.filters)) {
      parts.push(encodeURIComponent(k) + '=' + v);
    }
  }
  if (opts.order) parts.push('order=' + opts.order);
  if (typeof opts.limit === 'number') parts.push('limit=' + opts.limit);
  return parts.length ? '?' + parts.join('&') : '';
}

function buildFiltersQS(filters: Filters): string {
  return Object.entries(filters).map(([k, v]) => encodeURIComponent(k) + '=' + v).join('&');
}

// =====================================================================
// Low-level fetch — shared by every helper below.
//
// • Headers: apikey (anon, required by PostgREST), Authorization (Bearer
//   <cachedAccessToken> — falls back to anon key for cold-boot edge
//   cases, in which case PostgREST returns 401 and timeoutFetch's
//   refresh-on-401 path swaps in the real token).
// • Body: JSON-serialized when provided.
// • timeoutFetch handles: per-attempt AbortController + 6s dataplane
//   timeout + [fetch #N] funnel logs + refresh-on-401 + single retry.
// =====================================================================
interface DbRequestOpts {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;             // e.g. '/items?select=*&board_id=eq.X'
  body?: unknown;
  prefer?: string;          // 'return=representation' / 'return=minimal' / 'resolution=merge-duplicates,...'
  accept?: string;          // default 'application/json'
}

class DbError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly details: string | undefined;
  readonly hint: string | undefined;
  constructor(message: string, status: number, code?: string, details?: string, hint?: string) {
    super(message);
    this.name = 'DbError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.hint = hint;
  }
}

async function dbFetch<T>(opts: DbRequestOpts): Promise<T> {
  const token = getCachedAccessToken() ?? SUPABASE_ANON_KEY;
  const headers = new Headers({
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + token,
    'Accept': opts.accept ?? 'application/json',
  });
  if (opts.body !== undefined) headers.set('Content-Type', 'application/json');
  if (opts.prefer) headers.set('Prefer', opts.prefer);

  const resp = await timeoutFetch(REST_BASE + opts.path, {
    method: opts.method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });

  if (!resp.ok) {
    // PostgREST error body is JSON: { code, message, details, hint }.
    let bodyText = '';
    try { bodyText = await resp.text(); } catch { /* ignore */ }
    let code: string | undefined;
    let detailMsg = bodyText;
    let details: string | undefined;
    let hint: string | undefined;
    try {
      const parsed = JSON.parse(bodyText) as { code?: string; message?: string; details?: string; hint?: string };
      code = parsed.code;
      details = parsed.details;
      hint = parsed.hint;
      detailMsg = parsed.message ?? bodyText;
    } catch { /* not JSON */ }
    throw new DbError(detailMsg || `HTTP ${resp.status}`, resp.status, code, details, hint);
  }

  if (resp.status === 204) return undefined as T;
  const text = await resp.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

// =====================================================================
// Reads
// =====================================================================
export async function dbSelect<T>(table: string, opts: SelectOpts = {}): Promise<T[]> {
  return await dbFetch<T[]>({
    method: 'GET',
    path: '/' + table + buildSelectQS(opts),
  });
}

/** PostgREST returns []; this returns rows[0] ?? null. Matches supabase-js .maybeSingle(). */
export async function dbSelectMaybeSingle<T>(table: string, opts: SelectOpts = {}): Promise<T | null> {
  const rows = await dbSelect<T>(table, { ...opts, limit: opts.limit ?? 1 });
  return rows[0] ?? null;
}

/** Throws when rows !== 1. Matches supabase-js .single(). */
export async function dbSelectSingle<T>(table: string, opts: SelectOpts = {}): Promise<T> {
  const rows = await dbSelect<T>(table, { ...opts, limit: 2 });
  if (rows.length !== 1) {
    throw new DbError(`dbSelectSingle ${table}: expected 1 row, got ${rows.length}`, 406);
  }
  return rows[0]!;
}

// =====================================================================
// Mutations
// =====================================================================
/** POST a single row; no return. */
export async function dbInsert(table: string, body: object): Promise<void> {
  await dbFetch<undefined>({
    method: 'POST',
    path: '/' + table,
    body,
    prefer: 'return=minimal',
  });
}

/** POST a single row; return the inserted row (Prefer: return=representation). */
export async function dbInsertReturning<T>(table: string, body: object): Promise<T> {
  const rows = await dbFetch<T[]>({
    method: 'POST',
    path: '/' + table + '?select=*',
    body,
    prefer: 'return=representation',
  });
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new DbError(`dbInsertReturning ${table}: expected 1 row, got ${(rows as T[] | undefined)?.length ?? 0}`, 406);
  }
  return rows[0]!;
}

/** POST many rows; no return. */
export async function dbInsertMany(table: string, body: object[]): Promise<void> {
  if (body.length === 0) return;
  await dbFetch<undefined>({
    method: 'POST',
    path: '/' + table,
    body,
    prefer: 'return=minimal',
  });
}

/** PATCH rows matching filters; no return. */
export async function dbUpdate(table: string, filters: Filters, patch: object): Promise<void> {
  await dbFetch<undefined>({
    method: 'PATCH',
    path: '/' + table + '?' + buildFiltersQS(filters),
    body: patch,
    prefer: 'return=minimal',
  });
}

/** DELETE rows matching filters; no return. */
export async function dbDelete(table: string, filters: Filters): Promise<void> {
  await dbFetch<undefined>({
    method: 'DELETE',
    path: '/' + table + '?' + buildFiltersQS(filters),
    prefer: 'return=minimal',
  });
}

/** UPSERT — POST with on_conflict + resolution=merge-duplicates. No return. */
export async function dbUpsert(
  table: string,
  body: object | object[],
  opts: { onConflict: string },
): Promise<void> {
  await dbFetch<undefined>({
    method: 'POST',
    path: '/' + table + '?on_conflict=' + encodeURIComponent(opts.onConflict),
    body,
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

/** RPC — POST /rpc/<fn> with args body. */
export async function dbRpc<T>(fn: string, args?: object): Promise<T> {
  return await dbFetch<T>({
    method: 'POST',
    path: '/rpc/' + fn,
    body: args ?? {},
  });
}
