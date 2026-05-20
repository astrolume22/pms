# 🔧 PMS — Tech Stack & Architecture

> **Document 8 of 9** — How everything is wired. Lovable + Supabase + Gemini specifics.

---

## Stack Overview

```
┌─────────────────────────────────────────────────────┐
│ FRONTEND                                            │
│ React (via Lovable) + Tailwind CSS + shadcn/ui      │
│ TanStack Query for data fetching                    │
│ Zustand for client state                            │
│ Tiptap / Lexical for rich text                      │
│ Dnd-kit for drag & drop                             │
└──────────────────────────┬──────────────────────────┘
                           │ Supabase JS client
┌──────────────────────────▼──────────────────────────┐
│ BACKEND (Supabase)                                  │
│ - Postgres DB                                       │
│ - Auth (email/password)                             │
│ - Storage (file uploads)                            │
│ - Realtime (live updates)                           │
│ - Row Level Security (RLS) — permission enforcement │
│ - Edge Functions (Deno) — for Gemini calls, complex │
│   server logic, triggers                            │
└──────────────────────────┬──────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────┐
│ EXTERNAL                                            │
│ - Gemini API (all AI features)                      │
│ - Email service (Resend or Supabase built-in)       │
└─────────────────────────────────────────────────────┘
```

---

## 1. Lovable Setup

### Project type
- React app (Lovable default)
- Single-page app with client-side routing

### Routing library
- **TanStack Router** (file-based routing in `src/routes/`)
- **Why:** Lovable's React template uses TanStack Start/Router by default — swapping to React Router DOM is unsupported and would break the bootstrap
- **Benefits:** Type-safe routes, SSR-ready, file-based convention, modern
- **Folder structure:** `src/routes/` (not `src/pages/`)
- **File naming convention:**
  - `__root.tsx` → root layout (shell)
  - `_bare.tsx` → pathless bare layout (login/signup)
  - `index.tsx` → `/`
  - `w.$workspace.tsx` → `/w/:workspace`
  - `w.$workspace.b.$board.tsx` → `/w/:workspace/b/:board`
  - `w.$workspace.b.$board.p.$item.tsx` → task panel route
  - `admin.tsx` → `/admin`
  - `inbox.tsx`, `my-work.tsx`, `profile.tsx` → respective routes
  - `404.tsx` → catch-all

### State management
- **TanStack Query** (React Query) — for server state (boards, items, etc.)
- **Zustand** — for client state (active modal, current view filters, etc.)
- Avoid Redux — overkill

### Styling
- **Tailwind CSS** (Lovable default)
- **CSS variables** for design tokens (theme switching)
- **shadcn/ui** components as base (Lovable has built-in support)

### Component library
- shadcn/ui for: Button, Input, Dropdown, Modal, Dialog, Tooltip, Toast
- Custom components for: Pill, Avatar, TaskRow, KanbanCard, FieldEditor

---

## 2. Supabase Setup

### Project config
- Single Supabase project
- Region: closest to most users (probably Mumbai for South Asia team, or whatever matches)
- Database: Postgres 15+

### Auth
- **Provider:** Email + password (initially)
- **Email confirmation:** Required
- **Password rules:** Min 8 chars, at least 1 number
- **Session length:** 30 days (remember me default)
- **JWT expiry:** 1 hour, auto-refresh

### Storage
- **Bucket: `files`** — task file attachments
  - Public read for authenticated users (with RLS)
  - 10MB file size limit default (configurable)
- **Bucket: `avatars`** — user profile pictures
  - Public read
- **Bucket: `logos`** — workspace icons, account logo
- **Bucket: `vibe_assets`** — Gemini-generated view assets (if any)

### Realtime
- Enabled on: `items`, `item_column_values`, `updates`, `notifications`, `activity_log`
- Used for: live board updates, live notifications, live presence indicators (V2)

### Database extensions
- `uuid-ossp` — UUID generation
- `pg_trgm` — fuzzy text search
- `pgcrypto` — encryption (for storing Gemini API key)

---

## 3. Row Level Security (RLS) Strategy

**Every table has RLS enabled.** Frontend cannot bypass these — security is at DB level.

### Helper functions
```sql
-- Get current user's account role
CREATE FUNCTION get_user_role() RETURNS TEXT AS $$
  SELECT role FROM users WHERE id = auth.uid()
$$ LANGUAGE SQL SECURITY DEFINER;

-- Is user admin?
CREATE FUNCTION is_admin() RETURNS BOOLEAN AS $$
  SELECT role = 'admin' OR is_super_admin FROM users WHERE id = auth.uid()
$$ LANGUAGE SQL SECURITY DEFINER;

-- Can user access this board?
CREATE FUNCTION can_access_board(board_uuid UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM board_subscribers
    WHERE board_id = board_uuid AND user_id = auth.uid()
  ) OR EXISTS (
    -- Main boards are visible to all workspace members
    SELECT 1 FROM boards b
    JOIN workspace_members wm ON wm.workspace_id = b.workspace_id
    WHERE b.id = board_uuid AND b.board_type = 'main' AND wm.user_id = auth.uid()
  )
$$ LANGUAGE SQL SECURITY DEFINER;

-- Can user edit this board?
CREATE FUNCTION can_edit_board(board_uuid UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM board_subscribers
    WHERE board_id = board_uuid 
      AND user_id = auth.uid() 
      AND role IN ('owner', 'member')
  )
$$ LANGUAGE SQL SECURITY DEFINER;
```

### Example policies

```sql
-- Boards: SELECT
CREATE POLICY "board_select" ON boards FOR SELECT
USING (can_access_board(id) OR is_admin());

-- Items: SELECT
CREATE POLICY "items_select" ON items FOR SELECT
USING (can_access_board(board_id));

-- Items: INSERT / UPDATE / DELETE
CREATE POLICY "items_write" ON items FOR ALL
USING (can_edit_board(board_id));

-- Updates: SELECT — anyone who can see the item can read updates
CREATE POLICY "updates_select" ON updates FOR SELECT
USING (
  EXISTS (SELECT 1 FROM items WHERE items.id = updates.item_id AND can_access_board(items.board_id))
);
```

Every table gets similar policies. We write them as part of the Lovable prompt sequence.

---

## 4. Edge Functions (Server Logic)

Some logic must run server-side (security, secrets, complex compute).

### Edge functions list

| Function | Purpose |
|---|---|
| `gemini-sidekick` | Receive board/task context → call Gemini → return chat response |
| `gemini-vibe-view` | Receive prompt + schema → call Gemini → generate HTML/JS |
| `gemini-auto-labels` | Analyze items → call Gemini → return label suggestions |
| `gemini-column-suggest` | Receive natural language → return column type suggestion |
| `gemini-magic-solution` | Generate full workspace setup from prompt |
| `send-invite-email` | Send invitation email |
| `send-notification-email` | Send notification email (V2) |
| `generate-task-code` | Generate next task code for a board atomically |
| `bulk-action` | Handle multi-item operations atomically |
| `archive-restore` | Soft archive/restore logic |
| `export-board` | Generate CSV/Excel export |

### Gemini integration pattern

All Gemini calls go through edge functions to:
1. Hide API key from client
2. Add rate limiting per user
3. Log all calls in `ai_runs` table
4. Inject system prompts consistently
5. Handle errors gracefully

```typescript
// Pseudocode for gemini-sidekick edge function
export const handler = async (req: Request) => {
  const { userId, boardId, message, history } = await req.json();
  
  // Verify user can access board
  const canAccess = await checkBoardAccess(userId, boardId);
  if (!canAccess) return new Response('Forbidden', { status: 403 });
  
  // Fetch board context
  const context = await getBoardContext(boardId);
  
  // Build prompt
  const systemPrompt = buildSidekickPrompt(context);
  
  // Call Gemini
  const response = await callGemini({
    model: 'gemini-2.5-pro',
    systemPrompt,
    history,
    message
  });
  
  // Log
  await logAiRun({ userId, feature: 'sidekick', boardId, tokens: response.usage });
  
  return new Response(JSON.stringify(response), { status: 200 });
};
```

---

## 5. Gemini Integration Details

### API key management
- Stored in `account.gemini_api_key_encrypted` (pgcrypto encrypted)
- Decrypted only inside edge functions
- Admin-only access in admin panel
- Never sent to client

### Models used
| Use case | Model | Reasoning |
|---|---|---|
| Sidekick chat | `gemini-2.5-pro` | Best reasoning |
| Vibe view generation | `gemini-2.5-pro` | Complex code generation |
| Auto-assign labels | `gemini-2.5-flash` | Fast, simple classification |
| Column suggest | `gemini-2.5-flash` | Quick |
| Summarize updates | `gemini-2.5-flash` | Quick |
| Magic solution | `gemini-2.5-pro` | Complex multi-step planning |

### Rate limiting
- Per-user: 100 calls / hour (generous)
- Per-feature: configurable
- If hit: friendly toast "Slow down a bit, AI is thinking..."

### Cost tracking
- Log tokens used per call in `ai_runs`
- Admin dashboard shows: total cost estimate, top users, top features
- Set monthly budget alerts (optional)

---

## 6. Realtime Strategy

Supabase realtime broadcasts changes via Postgres logical replication.

### What's realtime in V1
- Board view: when an item is updated, all viewers see it instantly
- Notifications: new notification appears in bell instantly
- Updates feed: new updates appear without refresh

### Implementation
```typescript
// In React board view
useEffect(() => {
  const channel = supabase
    .channel(`board:${boardId}`)
    .on('postgres_changes', 
      { event: '*', schema: 'public', table: 'item_column_values',
        filter: `item_id=in.(${itemIds.join(',')})` },
      (payload) => {
        // Invalidate React Query cache
        queryClient.invalidateQueries(['board', boardId]);
      })
    .subscribe();
  
  return () => { supabase.removeChannel(channel); };
}, [boardId, itemIds]);
```

### Presence (V2)
- Who's currently viewing the board
- Show avatars top-right
- Updates every 30s heartbeat

---

## 7. File Upload Flow

1. User selects file in UI
2. Frontend uploads directly to Supabase Storage (signed URL)
3. After upload, frontend calls server function to create `files` row
4. Server returns file metadata
5. Frontend inserts `file_attachments` row linking to item/update
6. UI shows file with preview

### Limits
- Single file: 50MB max (configurable)
- Per-item total: unlimited (within bucket storage limit)
- Allowed types: most (block executables, scripts for safety)

### Image handling
- Auto-generate thumbnails (via edge function on upload)
- Lazy-load images with placeholders

---

## 8. Search Strategy

### V1: Basic
- Postgres full-text search using `tsvector` columns
- Indexed on: `items.name`, `items.task_code`, `updates.content_html`, `boards.name`
- Trigram extension for fuzzy matching

```sql
CREATE INDEX items_search_idx ON items 
USING GIN(to_tsvector('english', name || ' ' || coalesce(task_code, '')));
```

### V2: Semantic
- Embeddings via Gemini for items, updates, docs
- Stored in pgvector column
- Hybrid search (text + semantic)

---

## 9. Background Jobs

Some tasks shouldn't block user requests.

### Cron jobs (via Supabase scheduled functions)
| Job | Frequency | Purpose |
|---|---|---|
| Daily digest emails | Daily 8am user-tz | Send daily digest |
| Stale board detection | Weekly | Suggest cleanup |
| Activity log archival | Daily | Move old logs to cold storage (optional) |
| Token usage rollup | Daily | Aggregate AI costs |

### Triggered jobs
- Notification fan-out (when @mention, when assigned)
- Email send queue (for invitations)
- File thumbnail generation
- Item code generation on insert

---

## 10. Performance Optimizations

### Database
- Indexes on all FK and frequently-filtered columns (see Doc 3)
- Materialized views for heavy aggregations (V2)
- Connection pooling via Supabase pgBouncer

### Frontend
- React Query caching: 5min stale time default
- Optimistic updates for instant feedback
- Virtual scrolling on long boards (>100 rows)
- Code splitting per route
- Lazy load heavy components (Kanban, Gantt)

### Realtime
- Subscribe only to currently visible board
- Unsubscribe on route change
- Debounce rapid updates (e.g., typing in cell)

---

## 11. Deployment

### Environments
- **Production:** Lovable hosted (or custom domain on Vercel/Netlify)
- **Staging:** Lovable preview deployments
- **Local:** Lovable dev environment

### Custom domain (later)
- `pms.{ourcompany}.com`
- SSL via Lovable/Netlify auto
- Email DNS records for invite emails

### Environment variables
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (public, client-side)
- `SUPABASE_SERVICE_KEY` (secret, edge functions only)
- `GEMINI_API_KEY` (encrypted in DB, decrypted server-side)
- `RESEND_API_KEY` (for emails, V2)

---

## 12. Monitoring & Observability

### Logs
- Supabase logs (Postgres, Auth, Storage)
- Edge function logs
- Client errors → Sentry (V2)

### Metrics
- Auth: sign-ins, sign-up failures, password resets
- Performance: API response times, slow queries
- AI: calls per user, tokens consumed, error rate
- Storage: usage per workspace

### Alerts (V2)
- Gemini API errors > threshold
- Database connection saturation
- Storage approaching limit

---

## 13. Backup & Recovery

- Supabase automatic daily backups (built-in)
- Manual snapshots before major migrations
- Point-in-time recovery (paid Supabase plan — but worth it)

---

## 14. Security

### Top concerns
- **RLS bypassing** — never trust client-side checks alone
- **Gemini API key leak** — encrypted at rest, never sent to client
- **SQL injection** — Supabase JS client uses parameterized queries by default
- **XSS in updates** — sanitize rich text on render (Tiptap handles)
- **CSRF** — Supabase handles via session tokens
- **File uploads** — validate MIME, scan for malware (V2)

### Audit log
- All admin actions logged
- User can request data export (GDPR-style)
- Account deletion supported (cascade with soft deletes for content)

---

## 15. Mobile / PWA

- **PWA-enabled** in V1: manifest, service worker for offline shell
- Add to home screen on iOS/Android
- Push notifications (V2)
- Native apps via React Native (V3)

---

## 16. Internationalization (i18n)

- **English-first** in V1
- All UI text via i18n library (`react-i18next`)
- Strings extracted to `en.json` for future translation
- User can pick language in profile (only English available in V1)

---

## 17. Testing Strategy

### V1 (light)
- Manual testing during build (Lovable preview)
- Critical path tests written as part of Lovable prompts (auth, board CRUD, item CRUD)
- Smoke testing checklist (provided to team)

### V2 (more)
- Playwright E2E tests for key flows
- Vitest unit tests for utility functions
- RLS policy tests (programmatic)

---

## 18. Migrations & Schema Changes

- Use Supabase migrations (SQL files)
- Version controlled
- Apply via Supabase CLI or dashboard
- Always: add columns nullable first, backfill, then enforce NOT NULL

### Big-bang setup vs incremental
- Initial DB created in 1-2 large migrations (during build)
- Subsequent changes are small additive migrations
- Avoid breaking changes once team is using it

---

## 19. Lovable Prompt Strategy (high-level)

Lovable prompts will be written to:
- **Build in clear sequence** — never jump steps
- **Cite specific files** — "Modify `BoardView.tsx` to..."
- **Be self-contained** — each prompt completes a coherent unit
- **Reference docs** — "Per the schema in Doc 3..."
- **Include acceptance criteria** — "After this prompt, user should be able to..."

Full prompt sequencing in Doc 9.

---

## Document Status

| Field | Value |
|---|---|
| **Version** | 0.1 |
| **Status** | Draft — architecture defined |
| **Open questions** | • Confirm Resend vs Supabase email for invitations<br>• Confirm pgvector enabled from start (for V2 semantic search) |

---

> **Next doc:** `09-prompt-sequencing.md` — the actual Lovable prompt plan.
