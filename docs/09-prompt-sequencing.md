# 🚀 PMS — Lovable Prompt Sequencing

> **Document 9 of 9** — The build plan. Order of operations.

---

## How to read this doc

This is **NOT** the prompts themselves yet. It's the **order** in which we'll prompt Lovable, with what each prompt accomplishes, and the acceptance criteria.

We write **actual prompts** AFTER all 9 docs are locked.

---

## Build Principles

1. **Bottom-up, not feature-first.** Build data layer → then UI shell → then features.
2. **Vertical slices once shell exists.** After base is up, build one full feature top-to-bottom before next.
3. **Don't paint yourself into a corner.** Always think 3 steps ahead.
4. **Test after every prompt.** Don't accumulate bugs.
5. **Database first, UI second.** Always.

---

## PHASE 1 — Foundation (8-12 prompts)

Goal: empty app shell with auth, navigation, and seeded DB.

### P1.1: Project Init + Design Tokens
- Initialize Lovable React project
- Install dependencies: Tailwind, shadcn/ui, TanStack Router (default), TanStack Query, Zustand, Tiptap
- Set up CSS variables for all design tokens (Doc 7)
- Set up theme toggle (light/dark)
- Create folder structure: `/components`, `/pages`, `/hooks`, `/lib`, `/types`

**Acceptance:** App boots with empty layout, theme toggle works.

### P1.2: Supabase Schema — Core Tables
- Create migration with: `account`, `users`, `workspaces`, `workspace_members`, `folders`, `boards`, `board_subscribers`, `board_favorites`, `groups`
- Add indexes
- Enable RLS, write basic policies (admin sees all, members see what they belong to)

**Acceptance:** Schema in DB, can manually insert + RLS blocks unauth queries.

### P1.3: Supabase Schema — Items & Columns
- Migration with: `columns`, `column_labels`, `items`, `item_column_values`, `item_subscribers`
- Indexes + RLS
- Helper functions: `get_user_role()`, `is_admin()`, `can_access_board()`, `can_edit_board()`

**Acceptance:** Schema complete for board operation.

### P1.4: Supabase Schema — Updates, Files, Activity, Notifications
- Migration with: `files`, `file_attachments`, `updates`, `update_likes`, `update_views`, `update_mentions`, `activity_log`, `board_last_viewed`, `notifications`
- RLS for each
- Triggers: `item_created` → activity_log, `updates_insert` → notifications

**Acceptance:** Schema fully ready for V1.

### P1.5: Supabase Schema — Views, Dashboards, AI tracking
- Migration with: `views`, `dashboards`, `dashboard_boards`, `dashboard_widgets`, `ai_runs`, `item_tabs`
- Basic RLS

**Acceptance:** All V1 tables exist.

### P1.6: Auth UI — Login / Signup / Reset
- Pages: `/login`, `/signup`, `/forgot-password`, `/reset-password`
- Forms using shadcn/ui
- Wire to Supabase Auth
- Handle invite token in signup
- Redirect after login to `/`

**Acceptance:** Can sign up via invite, log in, reset password.

### P1.7: Global Layout Shell
- Top bar component (logo, search bar, right icons stubs)
- Icon rail (Workspace, Agents, Vibe, Notetaker, Favorites, More — stubbed)
- Left workspace panel (workspace switcher dropdown stub, workspace home + boards list stub)
- TanStack Router setup with file-based routes in `src/routes/` matching `/`, `/w/$workspace`, `/login`, `/signup`, etc.
- Auth guard: redirect to `/login` if not authed

**Acceptance:** Logged-in user sees shell with nav, can route between stub pages.

### P1.8: Workspace Home — Recents Tab
- `/w/:slug` route → workspace home page
- Tabs: Recents (default), Content, Collaborators, Permissions
- Recents tab: list of recently viewed boards (queries `board_last_viewed`)
- Empty state if no recents
- Click board → navigate to `/w/:slug/b/:board_slug`

**Acceptance:** User can navigate to workspace, see recent boards.

### P1.9: Admin Seed Data
- On first super-admin sign-in, seed:
  - 1 `account` row
  - 1 `workspace` row ("Main workspace", `is_main=true`)
  - `workspace_members` entry (super-admin as owner)
- Seed default column types registry
- Seed default label color palette

**Acceptance:** First user gets a working workspace automatically.

### P1.10: Admin Panel — Users + Settings
- `/admin` route (admin-only guard)
- Users tab: list, search, invite modal, deactivate, role change
- Settings tab: account name, logo, primary color, Gemini API key (encrypted save)

**Acceptance:** Admin can invite, manage users, set API key.

### P1.11: Invite Flow End-to-End
- Send invite email (Supabase magic link or custom edge function with Resend)
- Email template with link to `/signup?token=xyz`
- Token verification on signup
- Auto-add to workspace_members on signup

**Acceptance:** Admin invites email → that email gets email → signs up → ends up in workspace.

### P1.12: Foundation Polish
- Loading states (skeleton)
- Toast notification system
- Error boundary
- 404 page
- Auth state hydration on refresh

**Acceptance:** App feels complete at the shell level.

---

## PHASE 2 — Board Core (12-15 prompts)

Goal: working table view with groups, items, columns.

### P2.1: Board CRUD + Routing
- Create board modal (from sidebar `+` → Board → New Board)
- `/w/:ws/b/:board` route
- Board header: name (editable), owner, ⭐ favorite, info card on click
- Empty board state

**Acceptance:** Can create board, navigate to it, rename.

### P2.2: Sidebar — Workspace Items
- Show boards, dashboards, docs (stubbed) in workspace panel
- Icons per type
- Active state on current
- Star icon for favorited boards

**Acceptance:** Sidebar shows workspace contents, navigation works.

### P2.3: Groups CRUD
- Default group "Group Title" on board create
- "+ Add new group" button at bottom of board
- Group header: name (editable), color, ▶/▼ collapse toggle, task count, ... menu (duplicate, delete, change color)
- Drag to reorder groups
- Left color bar visualization

**Acceptance:** Can add, rename, color, reorder, collapse groups.

### P2.4: Items CRUD — Inline Add
- "+ Add task" row at end of each group
- Type name + Enter → creates item
- Auto-generate `task_code` (Task 1, Task 2, ...)
- Inline edit task name on click
- Right-click menu / ... menu: duplicate, delete, archive, move to

**Acceptance:** Can add tasks inline.

### P2.5: Columns — Basic Types (Text, Number, Status, Date, People)
- "+ Add column" button → dropdown column type picker
- Render based on type:
  - Text → input
  - Number → numeric input with unit
  - Status → colored pill, click → label picker
  - Date → date picker
  - People → avatar pill, click → user picker
- Inline editing for all

**Acceptance:** Can add columns, edit values, see colored pills.

### P2.6: Label Editor for Status/Priority
- Click status cell → label picker dropdown (2-column grid)
- "+ New label" → inline create
- "Edit Labels" → full modal
- Color picker per label
- Drag reorder
- "Auto-assign labels" button (stub for now, wire to Gemini in Phase 6)

**Acceptance:** Can fully customize label sets per column.

### P2.7: Columns — Files Column
- Files column type
- Click cell → upload dropdown (From Computer / From Link for V1)
- Drag-drop into cell to upload
- Show count + thumbnail in cell
- Files saved to Supabase Storage

**Acceptance:** Can attach files to items via column.

### P2.8: Columns — Remaining V1 Types
- Long text, Checkbox, Link, Email, Phone, Timeline, Priority, Dropdown
- Auto: Auto Number, Creation Log, Last Updated

**Acceptance:** All 18 V1 column types work.

### P2.9: Column Operations — Reorder, Resize, Hide, Pin
- Drag column header to reorder
- Drag right edge to resize (persist width in view settings)
- Hide button → checkbox list (save to view)
- ... menu: pin left/right, item height, conditional coloring (stub), default values

**Acceptance:** Columns are fully manageable.

### P2.10: Table Toolbar — Search, Sort, Filter, Group by
- Search this board: live-filters rows
- Sort: button → dropdown → pick column + asc/desc (multi-level)
- Filter: button → build filter UI (column + operator + value + AND/OR)
- Group by: button → pick column → re-renders board grouped that way
- Save filters/sort to view settings

**Acceptance:** Toolbar actions all work, persist per view.

### P2.11: Row Selection + Bulk Actions
- Checkbox column on left
- Select all checkbox in header
- Floating action bar when 1+ selected
- Actions: Duplicate, Export, Archive, Delete, Move to, Convert (basic)

**Acceptance:** Multi-select + bulk actions all work.

### P2.12: Subitems
- ▶ expand arrow on rows that have subitems
- Inline expand shows subitem table (subset of columns)
- "+ Add subitem" within
- Task codes: `Task 11-A`, `Task 11-B`

**Acceptance:** Subitems work fully.

### P2.13: Column Footer Summaries
- Below each group, show aggregate per column
- Status → distribution bar
- Number → sum
- Files → count
- People → unique avatars

**Acceptance:** Summaries appear and update live.

### P2.14: Item Drag-and-Drop
- Drag handle on row hover
- Drag within group → reorder
- Drag to another group → move + change `group_id`
- Visual feedback (drop indicator line)

**Acceptance:** Items can be rearranged via drag.

### P2.15: Board Info Card + Settings
- Click board name → info card pops (description, type, owner, created)
- Inline edit
- Board ... menu: archive, delete, change type, manage permissions
- Star to favorite

**Acceptance:** Board metadata is editable.

---

## PHASE 3 — Items Deep (10-12 prompts)

Goal: full task panel with updates, files, activity, custom tabs.

### P3.1: Task Slide-In Panel — Shell
- Click task row → URL adds `/p/{item_id}`
- Right panel slides in (~50% width)
- Board left compresses
- Panel header: ✕, task name (editable), avatar, ⋯
- Tabs row: Updates / Files / Activity Log / Build Vibe view / +
- Active row highlights in board

**Acceptance:** Panel opens/closes, navigation persists URL.

### P3.2: Task Full-Page View
- ⤢ "Open Task page" icon on row hover
- Navigates to `/p/{item_id}/full`
- Back to board button
- Fields zone at top (all columns as editable pills)
- Subitems section
- Tabs below
- Edits sync with table

**Acceptance:** Full task page works.

### P3.3: Updates Tab — Rich Text Editor
- Tiptap-based editor
- Toolbar: bold, italic, underline, strikethrough, text color, font size, lists, link, etc.
- @mention dropdown (filters workspace users)
- 📎 attach, GIF, emoji, draw
- "Update" button (primary) + dropdown for post options
- "Update via email" link (unique email per item)

**Acceptance:** Can post rich text updates.

### P3.4: Updates Tab — Feed + Replies
- List of updates (newest first)
- Author + avatar + date + breadcrumb (`Board > Group > Task`)
- Rich content rendered
- View count, Like, Reply
- Threaded replies (one level)
- Edit/delete own update via ... menu

**Acceptance:** Update feed works with threads.

### P3.5: Files Tab
- Add file button (dropdown: From Computer, From Link)
- Drag-drop zone
- Grid view (default) / List view toggle
- Each file: thumbnail, name, size, uploader, date
- Click → preview (image, PDF, fallback download)
- Search within files
- Delete files

**Acceptance:** Files tab fully functional.

### P3.6: Activity Log Tab (per-item)
- Filter log dropdown, Person filter, AI Powered toggle (stub)
- Refresh, export icons
- Entries: time ago, actor avatar, action, old → new, Undo button
- Unlimited history (no paywall)

**Acceptance:** Per-item activity visible with undo.

### P3.7: Board-Level Activity Log Panel
- Top-right `...` menu → "View activity log" → right panel slides in
- 3 tabs: Activity / Last Viewed / Updates
- Activity: same as item but board-scoped
- Last Viewed: list of users + last seen
- Updates: aggregated feed of ALL updates in board

**Acceptance:** Board log works with 3 tabs.

### P3.8: Notifications System — Generation
- Create notifications on:
  - @mention
  - Assigned to item
  - Reply to your update
  - Status change on subscribed item
  - File uploaded to subscribed item
- Realtime push to recipient
- Bell badge updates

**Acceptance:** Notifications fire correctly.

### P3.9: Notifications Panel
- Bell click → slide-in panel
- Tabs: All / Mentioned / Assigned to me
- Search
- Unread only toggle
- Each: avatar + actor + message + source + time
- Click → navigate to source, mark read

**Acceptance:** Notifications panel fully working.

### P3.10: Custom Task Tabs (+ Add Tab)
- + button on task tabs
- Dropdown: Item Card / Item description / Table / Chart / Gantt (stubs) / File Gallery (stub) / Dashboard / Emails & Activities (stub)
- For V1: implement only Item description (rich text doc per task) and File gallery
- Others as "Coming soon" placeholder

**Acceptance:** Item description tab works.

### P3.11: Item Subscriptions
- "Subscribe to updates" toggle on item
- 👤 owner icon in task header — click to assign owner
- @mention auto-subscribes mentioned user
- Show subscriber avatars on task

**Acceptance:** Subscription mechanics work.

### P3.12: Item Polish
- Star/favorite items
- Task code editable
- Comments count on row
- Subitems count icon on row
- Loading states throughout

**Acceptance:** Items feel complete.

---

## PHASE 4 — Views (8-10 prompts)

Goal: Kanban + Calendar views working.

### P4.1: Views System Foundation
- `views` table queries
- Tabs on top of board for each view
- + button → "Board views" dropdown
- Active view in URL: `/b/:board/v/:view_slug`
- Rename view (... menu), delete view, set default

**Acceptance:** Multiple views per board, switchable.

### P4.2: Kanban View
- Group by Status (or any label column) — columns
- Cards in each column
- Drag card to change status
- + Add task on each column
- Card config: ✏ + ... menu
- Card structure per Image 5/6

**Acceptance:** Kanban view fully usable.

### P4.3: Kanban Widget Settings Panel
- ⚙ icon → right side settings panel
- "Customize your Kanban card": Task / Sub-task tabs
- Drag columns onto card to add
- Show column name toggle
- Display cover image toggle (from Files column)
- Save per view

**Acceptance:** Kanban cards configurable.

### P4.4: Calendar View
- Group by a Date column
- Month/week/day toggle
- Items rendered as bars on dates
- Drag bar to reschedule
- Click → opens task panel
- Color-by selector

**Acceptance:** Calendar view works.

### P4.5: Build Vibe View (UI shell)
- Tab type: vibe
- Empty state: hero + prompt input + AI model dropdown + Build it
- Suggested prompts (Gemini-generated in Phase 6, hardcoded for now)
- Stub the actual generation (real wire-up in Phase 6)

**Acceptance:** Vibe view UI exists.

### P4.6: View Sharing & Personal Views
- "Share view" toggle in view settings
- Personal views only visible to creator
- Shared views visible to all board members
- Indicator on view tabs

**Acceptance:** View privacy works.

### P4.7: View Persistence — Filters, Sort, Groups
- Each view stores own filter/sort/group settings
- Saved on toolbar action
- "Save as new view" option in Hide dropdown

**Acceptance:** Views remember their state.

### P4.8: Form View Stub
- + Add view → Form (V2 placeholder for now)
- Shows "Forms coming in V2" message

**Acceptance:** Placeholder in place.

### P4.9: Gantt/Chart/Dashboard placeholders
- Same — show coming-soon placeholders

**Acceptance:** V2 features hinted but not built.

### P4.10: View polish
- Loading states
- Empty states per view type
- Animations between view switches

**Acceptance:** Views feel polished.

---

## PHASE 5 — Collaboration & Permissions (6-8 prompts)

### P5.1: Board Invite Modal
- "Invite / N" button on board header
- Modal: search users, "Anyone at company can access" indicator, list of invited with crown
- Role assignment per invitee
- Remove access

**Acceptance:** Can manage board subscribers.

### P5.2: Board Permissions Page
- Top-right ... → Permissions
- Detailed permissions per role
- Member management

**Acceptance:** Granular permissions UI exists.

### P5.3: Account-Level Roles Enforcement
- All RLS policies fully wired
- UI hides actions user can't perform
- Soft fallback: toast on permission errors

**Acceptance:** Roles work end-to-end.

### P5.4: Inbox Page
- `/inbox` route
- @mentions + assignments grouped by time
- Filters

**Acceptance:** Inbox functional.

### P5.5: My Work Page
- `/my-work` route
- All my assigned items across boards
- Grouped by due date
- Click → open task

**Acceptance:** My Work view works.

### P5.6: Email Notifications (basic V1)
- On @mention → email
- On assigned → email
- On reply → email
- Per-user preferences in profile
- Unsubscribe link

**Acceptance:** Critical email notifications send.

### P5.7: Search Global (Ctrl+K)
- Overlay with input
- Categorized results: Items, Boards, Updates, Files, Users
- Postgres full-text search
- Click result → navigate

**Acceptance:** Global search works.

### P5.8: Workspace Members + Permissions tabs
- Workspace home → Collaborators tab → member list, add new
- Permissions tab → workspace visibility settings

**Acceptance:** Workspace permissions managed.

---

## PHASE 6 — AI / Gemini (5-7 prompts)

### P6.1: Gemini Edge Function — Sidekick
- Edge function: `gemini-sidekick`
- Receives boardId, message, history
- Fetches board context
- Calls Gemini with system prompt
- Returns response
- Logs to `ai_runs`

**Acceptance:** Gemini chat works.

### P6.2: AI Sidekick UI
- Side panel from 💬 icon or board ... menu
- Greeting with user name
- Context chip
- Chat history
- Send button
- Suggested actions (Gemini-generated)

**Acceptance:** Sidekick fully integrated.

### P6.3: Vibe View Generation
- Edge function: `gemini-vibe-view`
- Receives prompt + board schema + sample data
- Gemini generates HTML/JS
- Sandbox the generated code
- Save to view settings
- Render in iframe (sandboxed) or shadow DOM

**Acceptance:** Vibe views render.

### P6.4: Auto-Assign Labels
- Edge function: `gemini-auto-labels`
- "Auto-assign labels" button in label editor
- Sends item names + label list to Gemini
- Returns suggested label per item
- Preview → user confirms → applies

**Acceptance:** Auto-labels work.

### P6.5: Column Suggest (search-or-describe)
- In Add Column dropdown, search bar
- Type natural language → calls `gemini-column-suggest`
- Returns suggested column type + config
- User confirms → adds column

**Acceptance:** AI column suggestions work.

### P6.6: AI Rate Limiting + Monitoring
- Per-user rate limit (100/hour)
- Friendly error if exceeded
- Admin dashboard with usage stats

**Acceptance:** AI usage controlled.

### P6.7: AI Sidekick — Take Actions
- Sidekick can return action JSON
- Frontend interprets: create item, move group, change status, etc.
- Confirmation step before executing
- Logged in activity log

**Acceptance:** Sidekick can act on the board.

---

## PHASE 7 — Admin & Polish (3-5 prompts)

### P7.1: Admin Panel Complete
- Audit log tab with filters
- Workspace management tab
- API keys tab with Gemini test connection

**Acceptance:** Admin panel finished.

### P7.2: User Profile Page
- About / Notifications / Theme / Security tabs
- Edit profile fields
- Avatar upload
- Notification preferences
- Password change

**Acceptance:** Profile management complete.

### P7.3: Archive / Trash System
- ... menu → View archive/trash
- Filter by type, date
- Restore / delete forever
- Auto-archive scheduled (V2)

**Acceptance:** Archive system works.

### P7.4: Conditional Coloring
- ... menu → Conditional coloring
- Rules builder: if {column} {operator} {value} → color row {color}
- Multi-rule support
- Apply in table + Kanban

**Acceptance:** Conditional coloring works.

### P7.5: Default Item Values
- ... menu → Default item values
- Set per column
- Applied on new task creation

**Acceptance:** Defaults work.

---

## PHASE 8 — Final Polish (5-8 prompts)

### P8.1: Theme + Responsive
- Dark mode complete
- All screens responsive
- Mobile tweaks

**Acceptance:** App works on all sizes + themes.

### P8.2: Keyboard Shortcuts
- Ctrl+K search
- Ctrl+/ help
- N for new task
- ESC closes panels
- Up/Down/Enter in lists

**Acceptance:** Power users happy.

### P8.3: Empty States Polish
- Custom illustrations per page
- Helpful CTAs

**Acceptance:** Empty states delightful.

### P8.4: Loading States Polish
- Skeletons everywhere
- Optimistic updates
- Network error fallbacks

**Acceptance:** App feels fast.

### P8.5: Realtime Hooks Refinement
- Debounce
- Reconnect logic
- Presence (stretch)

**Acceptance:** Realtime stable.

### P8.6: Export & Print
- Export board to CSV/Excel
- Print-friendly CSS

**Acceptance:** Data is portable.

### P8.7: PWA Setup
- Manifest, icons
- Service worker for offline shell
- Add-to-home prompt

**Acceptance:** PWA installable.

### P8.8: Final QA Pass
- Run full smoke test
- Fix outstanding bugs
- Deploy to production

**Acceptance:** V1 SHIPS.

---

## Prompt Writing Rules (when we get to actual prompts)

When writing each prompt for Lovable:

1. **Reference the docs** — "Per Doc 3 section 7.2, item_column_values schema is..."
2. **Be specific about files** — "Create `src/components/BoardView/KanbanCard.tsx`"
3. **Include acceptance criteria** — "After this, user can drag a card from Working on it to Done and see the status update."
4. **Anticipate failures** — "If migration fails, rollback by..."
5. **One coherent unit per prompt** — don't try to build multiple features
6. **Build then test** — "After implementing, manually verify: ..."
7. **Avoid scope creep** — if Lovable starts adding extras, course-correct
8. **Use design tokens** — never hardcode colors

---

## Estimated Timeline

| Phase | Prompts | Days (focused) |
|---|---|---|
| Phase 1 — Foundation | 12 | 5-7 |
| Phase 2 — Board Core | 15 | 7-10 |
| Phase 3 — Items Deep | 12 | 5-7 |
| Phase 4 — Views | 10 | 4-6 |
| Phase 5 — Collaboration | 8 | 3-5 |
| Phase 6 — AI | 7 | 3-5 |
| Phase 7 — Admin & Polish | 5 | 2-3 |
| Phase 8 — Final Polish | 8 | 3-5 |
| **TOTAL** | **~77 prompts** | **~32-48 days** |

With Lovable's typical credit cost per prompt, plan budget accordingly.

---

## When to Pause & Re-Plan

After each phase, do a checkpoint:
- Does the team like what's built?
- Any architectural surprises?
- Update docs if needed before next phase

This prevents 50 hours of wasted prompts.

---

## Document Status

| Field | Value |
|---|---|
| **Version** | 0.1 |
| **Status** | Draft — high-level plan locked |
| **Open questions** | Confirm exact prompt-writing convention once Phase 1 begins |

---

> **End of planning docs.** All 9 documents complete.
> Next step: review, refine, then start writing actual Lovable prompts.
