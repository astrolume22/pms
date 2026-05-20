# PMS — Phase 1 Setup & Run Guide

Everything for Phase 1 (Foundation + Auth) is in place. Two things still
need you in the loop: applying the SQL migrations to your **fresh** Supabase
project, and running the seed.

---

## 1. Add the database connection string

The Supabase JS client can't run DDL — only Postgres can. Open Supabase
Dashboard → **Project Settings → Database → Connection string → URI**, then
add it to `.env.local`:

```
DATABASE_URL=postgresql://postgres.<ref>:<DB_PASSWORD>@<host>:6543/postgres
```

Use the **Transaction Pooler** URL (port `6543`) — it works on networks
that block direct `5432`. Replace `<DB_PASSWORD>` with the password you set
when creating the project (it's not in any export — only you have it).

> If you've forgotten the DB password, Supabase Dashboard → Settings →
> Database → **Reset database password**.

---

## 2. Apply migrations

```powershell
npm run migrate
```

What this runs (in order, each in a transaction, idempotent):

| File | Contents |
|------|----------|
| `20260520_0001_phase1_schema.sql` | Tables: `account`, `users`, `workspaces`, `workspace_members`, `activity_log`. All FKs declared. `updated_at` triggers. |
| `20260520_0002_phase1_rls.sql`    | Helper functions (`is_admin`, `is_super_admin`, `is_active_user`, `current_user_role`) + RLS enabled + policies per the Phase 1 spec. |
| `20260520_0003_phase1_grants.sql` | Table grants to the `authenticated` role (RLS still gates everything). |

---

## 3. Verify foreign keys exist

```powershell
npm run verify-fks
```

This queries `information_schema` for the four FKs that matter and **exits
non-zero** if any is missing. (Lovable shipped without these last quarter —
never trusting the spec from now on.)

Expected output:

```
  ✓ users.id → auth.users(id)
  ✓ workspace_members.workspace_id → public.workspaces(id)
  ✓ workspace_members.user_id → public.users(id)
  ✓ activity_log.actor_id → public.users(id)

✅ All expected FKs are physically present.
```

---

## 4. Seed users + workspace

```powershell
npm run seed
```

What this creates (idempotent — re-run any time):

- 1 `account` row (`name: "PMS"`)
- 1 main workspace (`name: "Main workspace"`)
- 4 auth users + matching `users` rows + workspace memberships:

| Username | Password         | Role    | Notes |
|----------|------------------|---------|-------|
| `admin`  | `AstroPsychic28!` | admin   | Super admin |
| `pm1`    | `project123!`    | manager | |
| `pm2`    | `project123!`    | manager | |
| `pm3`    | `project123!`    | manager | |

The internal email is `<username>@pms.internal` — used only for Supabase
Auth, never shown in the UI.

---

## 5. Shortcut: full DB setup

```powershell
npm run db:setup
```

Runs migrate → verify-fks → seed in one go.

---

## 6. Run the app

```powershell
npm run dev
```

Open <http://localhost:5173>. You should land on `/login`.

### Manual test checklist

- [ ] `/` while signed out → redirected to `/login?redirect=%2F`
- [ ] `/login` shows username + password only (no email anywhere)
- [ ] Wrong password → toast says *"Username or password incorrect"* (generic)
- [ ] `admin` / `AstroPsychic28!` → lands on `/`, shell visible
- [ ] Avatar dropdown shows "Signed in as Master Admin" + `@admin` (no email)
- [ ] Avatar dropdown shows **Admin Panel** menu item
- [ ] Sign out → back to `/login`
- [ ] `pm1` / `project123!` → can sign in
- [ ] As pm1: avatar dropdown does **not** show Admin Panel
- [ ] Hit `/admin` as pm1 → redirected to `/` with toast "Admin access required"
- [ ] Workspace home → **Collaborators** tab lists all 4 users with avatar + name + role badge + `@username` (no email column)
- [ ] `/profile` shows username/role/joined/timezone/theme — no email field
- [ ] Edit full name + save → persisted after reload
- [ ] Change password → re-auth required, success toast, then sign-in with new password works
- [ ] Dark mode toggle in avatar dropdown → flips instantly; saved to `users.theme`; persists across reload
- [ ] `/signup` → redirects to `/login` (no public signup)

### Phase 2 (Boards) manual test checklist

- [ ] As `admin`: sidebar **+ Add new** dropdown opens; Board enabled, Dashboard/Doc/Folder show "V2" badge and are disabled
- [ ] Create board modal opens; icon picker shows 32 emojis; default type is **Main**
- [ ] Submit with empty name → toast "Board name is required"
- [ ] Create a board "Demo board" → toast "Board "Demo board" created", redirects to `/w/main/b/<uuid>`
- [ ] Default group "Group Title" renders with collapse arrow + status/owner/date/priority column headers
- [ ] Sidebar now lists the new board with its emoji; clicking it navigates back; active board has selected highlight
- [ ] Hover board row → ⋯ menu appears; Favorite toggles star (also shown in Favorites section); Rename inline-edits in place
- [ ] Copy link writes `<origin>/w/main/b/<uuid>` to clipboard → toast "Link copied"
- [ ] Board header: click name to inline-edit (Enter saves, Esc cancels); description placeholder is "Add description..." until edited
- [ ] Star button in board header mirrors favorite state
- [ ] As `pm1`: only sees main boards + boards they created/were invited to; cannot see admin's private boards
- [ ] As `pm1`: can create boards from sidebar
- [ ] Create a **Private** board as `pm1` → shows lock + "Private" badge in header; admin sees it (admin sees all), other pms don't
- [ ] Archive a board as owner → board disappears from sidebar; visiting its URL shows archived banner with **Restore** button
- [ ] Restore → banner goes away; sidebar re-includes it
- [ ] Delete a board → confirmation prompt; on success, redirects to `/`
- [ ] Workspace home **Recents** tab lists boards in last-viewed order (timestamp updates each visit)
- [ ] Workspace home **Content** tab shows Name / Type / Owner / Created / Updated columns; clicking a row navigates to the board
- [ ] Visit `/w/main/b/00000000-0000-0000-0000-000000000000` → admin sees "Board not found"; pm sees "You don't have access"
- [ ] Theme toggle still works on the board page

### Phase 3 (Tasks + Columns) manual test checklist

**Task code generation**
- [ ] Create a board → first row "+ Add task" types "Implement login" + Enter → row appears with code `Task 1`
- [ ] Add another → `Task 2`. Codes increment per board even after deletes (counter is monotonic).
- [ ] Expand the row → "+ Add subitem" creates `Task 1-A`, `Task 1-B`, ...

**Inline editing — all 10 column types**
- [ ] Task name (sticky-left): click to edit, Enter saves, Esc cancels. Code shown right-aligned in same cell.
- [ ] Text cell: click → input, Enter saves. Clearing text wipes the value (row disappears from values).
- [ ] Status cell: full-cell colored pill, click opens picker, single-select.
- [ ] Priority cell: same picker behaviour, different default labels.
- [ ] Dropdown cell: multi-select, shows up to 3 pills + "+N" overflow.
- [ ] People cell: click → searchable user picker, multi-select, avatars overlap.
- [ ] Date cell: calendar popover; Today/Clear buttons; **overdue dates render red**, today renders brand-blue.
- [ ] Numbers cell: right-aligned, Enter saves; unit prefix/suffix respected via `column.settings`.
- [ ] Checkbox cell: click toggles immediately (no edit mode).
- [ ] Link cell: popover with URL + display text; opens in new tab; `https://` auto-prepended.

**Label management**
- [ ] On a status/priority/dropdown cell picker, click **Edit Labels** → modal opens
- [ ] Rename via inline input (color of pill matches preview), pick a color from the 18-color palette
- [ ] Set a default label (star icon — only one default per column)
- [ ] Delete a label → confirms; rows referencing it lose the label silently
- [ ] Reorder via ▲▼ buttons; Apply saves

**Columns**
- [ ] **+** at end of header row opens type picker grouped by Essentials / Labels / People / Other
- [ ] Pick "Text" → new column appears at end with default name "Text"; double-click to rename
- [ ] Drag a column header sideways → reorders (task_name stays pinned first)
- [ ] Drag right edge of header → resize; release persists width
- [ ] Column ⋯ menu: Rename / Edit labels (for label types) / Hide column / Delete column with confirm
- [ ] Try to delete task_name → blocked by DB trigger; error toast shows
- [ ] Hide a column via Hide toolbar menu (with checkboxes) → it disappears; chip at bottom says "1 column hidden"; toggle back to restore

**Groups**
- [ ] "+ Add new group" → inline input → creates with random color
- [ ] Click group title to collapse; state persists across reloads (localStorage)
- [ ] Group ⋯ menu: Rename / Change color (12-color palette) / Delete with confirmation if group has tasks
- [ ] Drag group header sideways/vertically → reorders board groups (use the grip handle on hover)

**Drag & drop**
- [ ] Drag an item by the grip handle → reorders within its group (sort_order persists)
- [ ] dragging across groups in V1 is not supported (will arrive in V2 — drop-into-another-group)
- [ ] Subitems drag within parent — same handle pattern

**Bulk select**
- [ ] Click row checkboxes → floating bar at bottom shows "N selected"
- [ ] Bar actions: Archive (bulk) / Move to (dropdown of groups) / Delete (confirm)
- [ ] **X** on bar clears selection

**Toolbar**
- [ ] New task → adds a task to the first group
- [ ] Search "task 1" → filters down to matches (matches name or task_code; expands buckets with hits)
- [ ] Sort → menu lets you pick a column + direction; column header shows a chevron indicator
- [ ] Hide → checkbox list; task_name can't be hidden
- [ ] Group by → groups by Status / Priority / People labels (virtual buckets, default "By group" restores)
- [ ] Density → compact/comfortable/spacious changes row height live (persists per board+user)

**Column footers**
- [ ] Numbers column: shows Σ sum
- [ ] Checkbox column: shows done/total
- [ ] Status/Priority/Dropdown: shows colored distribution bar
- [ ] People column: shows assignee avatar stack with overflow

**Permissions**
- [ ] As pm1 on admin's main board: can create tasks, edit cells, drag-reorder
- [ ] As pm1 on admin's private board (if subscribed as viewer): cells render but click does nothing
- [ ] Viewer cannot delete columns/groups (menu hidden)

### Phase 4 (Task details + Comments + Files + Activity) manual test checklist

**Opening the task panel**
- [ ] Hover a task row → ⤢ icon appears in the task-name cell; click → URL becomes `…?p=<itemId>`; slide-in panel animates from the right (~250 ms)
- [ ] ESC or backdrop click closes the panel; URL drops the `?p=` query
- [ ] Click the small message-icon next to ⤢ → also opens the panel
- [ ] Panel header shows breadcrumb (workspace → board) + task name + monospaced task code

**Inline editing inside the panel**
- [ ] Task name in panel header inline-editable (Enter saves, Esc cancels)
- [ ] Fields zone shows every non-task_name column as Label → Editor; edits propagate to the table in real time

**Updates tab (Tiptap)**
- [ ] Composer toolbar: Bold, Italic, Bulleted list, Numbered list, Link
- [ ] Bold/italic toggles render in saved HTML
- [ ] Bulleted/numbered lists render correctly after posting
- [ ] Link button prompts for URL, autoprepends `https://`, opens in new tab
- [ ] Type `@` → mention dropdown opens with up to 8 matching active users; up/down arrows + Enter, or click to insert; chip styled with brand color
- [ ] Submitting empty content → toast "Write something first"
- [ ] Posting an update with a mention to `pm2` → `pm2` sees the notification badge update within 30 s (or immediately on next bell click)
- [ ] Updates list shows author avatar + full name + `@username` + relative time
- [ ] Edit own update → opens editor inline; saves with "(edited)" indicator
- [ ] Delete own update → confirmation → row disappears
- [ ] Admin can delete any update; manager/viewer can't
- [ ] Reactions: click 🙂 next to an update → emoji palette (6 options); clicking an emoji toggles your reaction; counts aggregate

**Files tab**
- [ ] Drag a file from desktop onto the drop zone → uploads, appears in list
- [ ] "Click to browse" → file picker; multi-file upload works
- [ ] Image MIME type → inline thumbnail in the list
- [ ] Click the download icon → opens signed URL in new tab; signed URL is fresh on each render (60 min expiry)
- [ ] Uploader can delete own file; admin can delete any; others get no trash icon
- [ ] Storage path is `boards/<board>/items/<item>/<uuid>-<name>` — visible in the Supabase Storage dashboard
- [ ] Attempt to access a file from a board you don't have access to (try the signed URL after losing access) → fails with 403 from storage

**Activity tab**
- [ ] After creating the task → "Created this task" appears
- [ ] Edit task name → "renamed it from X to Y"
- [ ] Change Status cell → "changed Status from "Working on it" to "Done""
- [ ] Post an update → "posted an update"
- [ ] Upload a file → "uploaded <filename>"
- [ ] Assign a person (people column) → activity row + the assignee gets an "assigned you to a task" notification

**Subitems section (in panel, top-level items only)**
- [ ] Lists subitems with `Task 1-A`, `Task 1-B` codes
- [ ] "+ Add subitem" input → Enter creates a subitem with the right code
- [ ] Click a subitem row → panel re-opens for that subitem (URL `?p=<subitemId>`)
- [ ] Subitems are NOT shown for items that are themselves subitems

**Files column type**
- [ ] Toolbar → + (add column) → Other → **Files** → new column appears
- [ ] Cell shows `📎 —` when empty; click opens upload popover
- [ ] Drag file onto popover → uploads → cell shows `📎 1` + thumbnail (for images)
- [ ] Cell can hold multiple files; thumbnail row shows up to 3
- [ ] Files in this column appear at `boards/<board>/items/<item>/<uuid>-…` and are visible only when you have board access

**Full-page task view**
- [ ] In the panel, click the ⛶ Maximize icon → navigates to `/w/main/b/<board>/i/<item>`
- [ ] Wider layout (max-w 1000 px), Back to board link, same fields + tabs
- [ ] Editing on the full page reflects in the board's table
- [ ] Browser Back → returns to the board

**Notifications**
- [ ] Bell icon shows red badge with unread count; `99+` if over 99
- [ ] Click bell → dropdown panel anchored top-right
- [ ] Unread rows have a tiny blue dot + lighter selected background
- [ ] Click a notification → marks read (badge decrements), navigates to its task panel
- [ ] "Mark all read" link clears all unread
- [ ] Empty state shows "You rock!"
- [ ] As `pm2`: receive a `mention` notif when `admin` mentions you in an update
- [ ] As `pm2`: receive a `comment` notif when someone replies on a task you created
- [ ] As `pm2`: receive an `assigned` notif when someone adds you to a people cell

**RLS**
- [ ] Updates / files / mentions / reactions are invisible to users without board access (URL-poking returns nothing via PostgREST)
- [ ] Notifications are visible only to the recipient (each user sees only their own)

---

## Project layout

```
src/
├── components/
│   ├── Avatar.tsx, RoleBadge.tsx, Spinner.tsx, ErrorBoundary.tsx
│   └── shell/
│       ├── AppShell.tsx         (TopBar + IconRail + WorkspacePanel + Outlet)
│       ├── TopBar.tsx           (#292F4C dark bar, "PMS" logo, avatar menu)
│       ├── IconRail.tsx         (Workspace/Agents/Vibe/Notetaker/Favorites/More)
│       └── WorkspacePanel.tsx   (workspace switcher, Workspace home link)
├── lib/
│   ├── cn.ts
│   ├── supabase.ts              (browser client w/ anon key)
│   └── database.types.ts        (hand-curated until `supabase gen types`)
├── hooks/
│   ├── boards.ts                (TanStack Query hooks for boards)
│   ├── items.ts                 (items + cell values + bulk actions)
│   ├── groups.ts, columns.ts, labels.ts, users.ts
│   ├── updates.ts, files.ts, notifications.ts, activity.ts
├── routes/                       (file-based, TanStack Router)
│   ├── __root.tsx
│   ├── _bare.tsx                (no shell — login/signup)
│   ├── _bare.login.tsx
│   ├── _bare.signup.tsx         (redirects to /login)
│   ├── _app.tsx                 (auth-gated layout)
│   ├── _app.index.tsx           (workspace home — / )
│   ├── _app.profile.tsx         (/profile)
│   ├── _app.admin.tsx           (/admin — admin-only stub)
│   ├── _app.w.$workspace.b.$boardId.tsx          (board page + ?p= panel)
│   └── _app.w.$workspace.b.$boardId.i.$itemId.tsx (full-page task view)
├── components/board/
│   ├── BoardHeader.tsx          (icon, name/description inline-edit, favorite, menu)
│   ├── BoardTabs.tsx            (Main table tab + V2 add-view stub)
│   ├── BoardToolbar.tsx         (search/sort/hide/group-by/density toolbar)
│   ├── BoardContent.tsx         (DnDContext orchestrator + bucket logic)
│   └── table/
│       ├── ColumnHeader.tsx     (rename / resize / reorder / menu)
│       ├── AddColumnMenu.tsx    (Essentials / Labels / People / Other type picker)
│       ├── GroupBlock.tsx       (sortable group with rows + footer)
│       ├── ItemRow.tsx          (gutter + sticky task-name + sortable + cell strip)
│       ├── AddItemRow.tsx       (inline "+ Add task")
│       ├── AddGroupRow.tsx      (inline "+ Add new group")
│       ├── BulkActionBar.tsx    (floating bottom bar — archive/move/delete)
│       ├── ColumnFooter.tsx     (Σ / distribution / avatar stack summaries)
│       ├── LabelPicker.tsx, LabelsEditorModal.tsx
│       ├── PersonPicker.tsx, DatePopover.tsx, Popover.tsx
│       └── cells/
│           ├── CellRenderer.tsx (dispatcher)
│           ├── TaskNameCell.tsx, TextCell.tsx, LabelCell.tsx
│           ├── PeopleCell.tsx, DateCell.tsx, NumbersCell.tsx
│           ├── CheckboxCell.tsx, LinkCell.tsx
│           └── FilesCell.tsx
├── components/task/
│   ├── TaskPanel.tsx            (slide-in right panel, backdrop, ESC)
│   ├── TaskDetail.tsx           (shared body for panel + full-page)
│   ├── TaskFieldsZone.tsx       (vertical column editors)
│   ├── UpdatesTab.tsx           (Tiptap composer + feed + reactions + edit/delete)
│   ├── FilesTab.tsx             (drag-drop upload + signed URL downloads)
│   ├── ActivityTab.tsx          (rendered activity_log with relative times)
│   ├── SubitemsSection.tsx      (collapsible, inline add)
│   ├── RichTextEditor.tsx       (Tiptap + @mentions, no tippy.js)
│   └── MentionList.tsx          (keyboard-navigable mention picker)
├── components/notifications/
│   └── NotificationsPanel.tsx   (anchored dropdown from the bell)
├── components/
│   ├── Modal.tsx, EmojiPicker.tsx, CreateBoardModal.tsx, EmptyMessage.tsx
│   └── shell/
│       ├── BoardRowMenu.tsx     (sidebar ⋯ menu per board)
│       └── AddNewMenu.tsx       (+ Add new dropdown in sidebar)
├── state/
│   ├── authStore.ts             (Zustand: status/session/profile/signIn/signOut)
│   └── themeStore.ts            (light/dark, persists to localStorage + users.theme)
├── index.css                    (Tailwind + CSS-var design tokens)
├── main.tsx                     (Router + QueryClient + Toaster + ErrorBoundary)
└── routeTree.gen.ts             (auto-generated, gitignored)

scripts/
├── migrate.ts        (apply supabase/migrations/*.sql against DATABASE_URL)
├── verify-fks.ts     (checks information_schema for expected FKs)
└── seed.ts           (idempotent seed via Auth Admin API + tables)

supabase/migrations/
├── 20260520_0001_phase1_schema.sql
├── 20260520_0002_phase1_rls.sql
└── 20260520_0003_phase1_grants.sql
```

---

## Design tokens — quick reference

Live in [src/index.css](src/index.css) as CSS variables (light + `.dark`
override) and surfaced as Tailwind utilities in
[tailwind.config.js](tailwind.config.js).

- Brand: `#0073EA` (hover `#0060BD`, active `#004B95`)
- Dark header: `#292F4C`
- Surfaces: `app`, `surface`, `hover`, `selected`, `dark`
- Text: `text-primary`, `text-secondary`, `text-disabled`, `text-on-dark`
- 18 label colors under `label.*` (green, red, orange, …)
- Semantic: `success`, `warning`, `error`, `info`
- Spacing scale = 4 px grid; radii `sm` 4, base 6, `md` 8, `lg` 12, `pill` 9999
- Font: Roboto (loaded via Google Fonts in [index.html](index.html))

No hard-coded colors anywhere in components — everything routes through
tokens.

---

## Known phase-1 limitations (intentional)

- No public signup, no password-reset-by-email — both removed per the
  simplified plan. Admin resets passwords directly in Phase 6.
- "Search" input in the top bar is visual-only.
- Notification bell + inbox icons are stubs.
- Workspace panel "Boards" section says "No boards yet" — boards arrive in
  Phase 2.
- Workspace switcher only shows the main workspace (no multi-workspace in
  V1).
