# 🚶 PMS — User Flows

> **Document 5 of 9** — Step-by-step journeys for the main scenarios.

---

## How to read this doc

Each flow shows:
- Who the actor is
- What they want to accomplish
- Step-by-step happy path
- Edge cases / errors
- What data is created/modified

---

## Flow 1: First-Time Login (Existing User Was Invited)

**Actor:** New team member who was invited by admin.

1. User receives invite email with magic link
2. Clicks link → arrives at `/signup?token=xyz` with email pre-filled
3. Enters: full name, password
4. Submits → backend:
   - Creates auth user
   - Updates `users` row from `invited` → `active`
   - Logs them in
5. Redirects to `/` → which redirects to default workspace home
6. **First-run tour** (optional) — quick walkthrough of sidebar, boards, AI Sidekick

**Edge cases:**
- Token expired → "Invite expired, ask your admin to resend"
- Email mismatch → "This invite is for a different email"

---

## Flow 2: Returning User Login

**Actor:** Any existing user.

1. Lands at `/login`
2. Enters email + password
3. Submits → Supabase auth verifies
4. Updates `users.last_active_at`
5. Redirects to last-visited URL (or `/` if first session)

**Edge cases:**
- Wrong password → inline error
- 3 failed attempts → "Forgot password?" hint highlighted
- Deactivated account → "Account deactivated. Contact admin."

---

## Flow 3: Forgot Password

1. `/login` → click "Forgot password?"
2. Enter email
3. Backend sends reset email (via Supabase)
4. Click link → `/reset-password?token=xyz`
5. Enter new password (twice)
6. Submit → auto-login, redirect to `/`

---

## Flow 4: Create a New Board

**Actor:** Workspace member.

1. In left sidebar, hover workspace name → click `+` button
2. "Add new" dropdown opens — click **Board** ▶
3. Submenu: **New Board** / New multi-level board / Start with template → click **New Board**
4. Modal opens: "Create board"
   - **Name** input (required)
   - **Description** (optional)
   - **Board type** dropdown: Main / Shareable / Private (default: Main)
   - **Workspace** dropdown (defaults to current)
   - **Folder** dropdown (optional)
5. Click "Create board"
6. Backend:
   - Inserts `boards` row
   - Inserts `groups` row (1 default group: "Group Title")
   - Inserts `columns` rows for default columns: Task (mandatory), Status, Date, People
   - Inserts default labels for Status column
   - Creates default Table view in `views`
   - Subscribes creator as `owner` in `board_subscribers`
7. Navigates to `/w/main/b/{new_board_slug}` → empty board ready to use

---

## Flow 5: Create a New Task (Item)

**Actor:** Board member, viewing the board.

### Method A: Inline (bottom of group)
1. Scroll to a group → click "+ Add task" row
2. Inline input appears, focused
3. Type task name → press Enter
4. Backend:
   - Inserts `items` row in that group, end of `sort_order`
   - Auto-generates task_code (next available)
   - Inserts default `item_column_values` for required columns
   - Logs `activity_log: item_created`
   - Sends notifications to board subscribers (if subscription level allows)
5. New row appears in table, user can immediately edit other cells

### Method B: Top toolbar "New task" button
1. Click "New task" button → modal/expanded form opens
2. Choose group (dropdown)
3. Enter name + initial values for fields
4. Submit → same backend flow

### Method C: From Kanban
1. In Kanban view, click "+" on a column header
2. Inline card appears with name input
3. Type → press Enter → task created with that column's status pre-set

---

## Flow 6: Edit Cell Inline (Status Change)

**Actor:** Board member.

1. Click on a Status cell in any row
2. Label picker dropdown appears (2-column grid)
3. Click any label
4. Backend:
   - Updates `item_column_values.value_jsonb` with new label_id
   - Logs `activity_log: column_changed` (old → new)
   - Sends notifications:
     - To item owner (if not the actor)
     - To assignees (if not the actor)
     - To board subscribers with "Everything" notification level
   - Triggers any automation matching this status change (V2)
5. Cell instantly shows new color, dropdown closes
6. Activity log shows the change with Undo button (board-level + item-level)

---

## Flow 7: Add a Subitem

**Actor:** Board member.

1. Hover over a task row → ▶ expand arrow appears next to checkbox
2. Click ▶ → row expands inline showing existing subitems + "+ Add subitem"
3. Click "+ Add subitem" → inline input
4. Type name → Enter
5. Backend:
   - Inserts `items` row with `parent_item_id = parent_task_id`
   - Task code: `{parent_code}-A`, `{parent_code}-B`, etc.
6. Subitem appears nested under parent
7. Subitems have their own column set (typically a subset of parent columns)

**Alternative:** Open task full page → "Subitems" section → "Add subitem".

---

## Flow 8: Open Task Detail (Slide-In Panel)

1. Click anywhere on task row (not on a cell) OR click 💬 update icon
2. URL updates to `/w/main/b/team-projects/p/{item_id}`
3. Right panel slides in:
   - Board on left (compressed)
   - Panel on right with: task name, tabs (Updates / Files / Activity / Vibe / +)
4. Updates tab is default
5. User can post update, view files, see activity
6. Click ✕ → panel closes, URL reverts to `/b/team-projects`
7. **Last viewed timestamp** updated in `board_last_viewed` for this user

---

## Flow 9: Open Task Full Page

1. Hover task row → ⤢ "Open Task page" icon appears
2. Click → navigates to `/w/main/b/team-projects/p/{item_id}/full`
3. Full-page layout:
   - Top bar: ← back to board, task name, ... actions
   - **Fields zone**: status, owner, assignees, dates, priority, etc. as pills (editable)
   - Tabs row: Updates / Files / Activity / Vibe / +
   - Tab content fills rest of page
4. Edits sync with table view in real-time
5. Click ← back → returns to board

---

## Flow 10: Post an Update with @Mention

**Actor:** Board member, on a task.

1. Open task → Updates tab
2. Click in rich text editor
3. Type "@" → mention dropdown appears with user list
4. Type "ar" → filters to "Arslan", "Aryan"
5. Click "Arslan" → @Arslan inserted as pill
6. Continue typing message
7. Click **Update** button
8. Backend:
   - Inserts `updates` row
   - Inserts `update_mentions` row for Arslan
   - Inserts `notifications` for Arslan: type=`mention`
   - Realtime push to Arslan if online
   - Email notification (V2)
9. Update appears in feed instantly
10. Arslan sees notification bell badge update

---

## Flow 11: Upload a File to Task

1. Open task → Files tab
2. **Method A:** Drag file from desktop onto the upload zone
3. **Method B:** Click "Add file" → dropdown → "From Computer"
4. File uploads to Supabase Storage
5. Backend:
   - Inserts `files` row
   - Inserts `file_attachments` linking file to item
   - Logs `activity_log: file_uploaded`
6. File appears in grid/list view of Files tab
7. Click file → preview opens (image inline, PDF in iframe, other → download)

---

## Flow 12: Use Filter

1. Click **Filter** button in toolbar
2. Filter dropdown opens
3. Click "+ Add filter"
4. Select column (e.g., Status)
5. Select operator (is / is not / is empty / is not empty)
6. Select value (Status labels appear as multi-select)
7. Click "Apply"
8. Table filters in real-time
9. Filter chip appears in toolbar: "Status is Working on it ✕"
10. Filter persists in URL (`?filter=...`)
11. Click "Save filter" → option to save as new view or update current view

---

## Flow 13: Change View (Switch Table → Kanban)

1. Top of board, click on a view tab (e.g., "Kanban")
2. URL changes: `/w/main/b/team-projects/v/kanban`
3. View renders with that view's saved config
4. State (filters, sort, group_by) persists per view

### Add new view
1. Click `+` next to view tabs
2. "Board views" dropdown opens (Image 4 from earlier)
3. Click "Kanban" (or any type)
4. Modal: "Name your view" + "Group by which column?" (for Kanban)
5. Create → new view tab appears + becomes active

---

## Flow 14: Use Kanban (Drag Card to Change Status)

1. In Kanban view, locate a card in "Working on it" column
2. Click and drag card to "Done" column
3. On drop:
   - Backend updates `item_column_values` for that Status column → "Done" label
   - Activity log entry
   - Notifications fire
4. Card animates to new column, status pill on card updates

---

## Flow 15: Invite a User to a Board

1. Top-right click "Invite / 1" button on board header
2. Modal: "Invite to this board"
3. Search by name, team, or email
4. **Case A: Existing user** → click to add
5. **Case B: New email** → "Invite {email} to PMS" option
   - Backend creates `users` row with status=`invited`
   - Sends email invite
   - Adds to `board_subscribers` with role=`member` (default)
6. Invitee appears in "People invited to this board" list
7. Can change role with dropdown next to name
8. Click crown ✕ to remove access

---

## Flow 16: Use AI Sidekick

1. Open any board
2. Click 💬 chat icon top-right (or keyboard shortcut)
3. AI Sidekick panel slides in from right
4. Greeting: "Hey {first_name}, How can I help you move forward with this board?"
5. Context chip shows current board name
6. Suggested actions shown (Gemini-generated based on board state)
7. User types: "Organize items by project phase within each group"
8. Backend:
   - Gemini API call (with board context: groups, items, columns)
   - Gemini returns either text response OR structured action JSON
   - If action JSON → preview to user → confirm → execute (reorder items, create groups, etc.)
   - Logged in `ai_runs` table
9. AI confirms what it did, suggests next steps

---

## Flow 17: Build Vibe View

1. In board, click "+" next to view tabs → "Vibe view" (or click existing "Build Vibe view" tab)
2. Full-page hero: "Turn your words into work apps"
3. User types: "Build me a kanban-style dashboard showing only Highest Priority tasks, with charts for each team"
4. Click "Build it"
5. Backend:
   - Gemini API call (with board schema, columns, current data sample)
   - Gemini generates HTML + JS code for custom view
   - Stored in `views.settings_jsonb.generated_html / generated_js`
6. View renders the custom UI
7. User can edit prompt and re-generate, or save as named view

---

## Flow 18: View Notifications

1. Top-right bell icon click
2. Notifications panel slides in from right
3. Tabs: All / Mentioned / Assigned to me
4. List shows notifications:
   - Avatar + actor name
   - Action message ("mentioned you in...")
   - Source (board / task name, clickable)
   - Timestamp
   - Unread → highlighted background
5. Click a notification → navigates to source (e.g., task panel opens)
6. Notification marked as read
7. "Unread only" toggle filters list
8. Search box filters by text
9. Settings (⚙) opens preferences modal

---

## Flow 19: Bulk Action on Multiple Tasks

1. In table view, check checkboxes on multiple rows
2. Floating action bar appears at bottom: "{N} Task selected"
3. Action buttons: Duplicate / Export / Archive / Delete / Convert / Move to / Sidekick / Apps
4. **Move to:** opens picker → select target group → all selected items move there
5. **Archive:** all items set `archived_at = now()`, removed from view
6. **Delete:** confirmation dialog → soft delete (recoverable from trash)
7. **Sidekick:** opens AI chat with these items as context (e.g., "Summarize these 5 tasks")

---

## Flow 20: Edit Labels (Status/Priority)

1. Click any cell of a Status column → label picker opens
2. At bottom of picker, click "✏ Edit Labels"
3. Modal opens with 2-column grid of all labels for this column
4. **Add label:** Click "+ New label" → input + color picker → save
5. **Rename:** Click on label name → edit inline → blur to save
6. **Recolor:** Click color swatch → palette opens → select → applies
7. **Reorder:** Drag label to new position
8. **Delete:** Hover → ... menu → Delete → confirmation
9. **Auto-assign labels:** Click ✨ at bottom → Gemini analyzes all items' names + descriptions → suggests label assignments → user reviews → applies
10. Click "Apply" → all changes save in one transaction

---

## Flow 21: Search Globally (Cmd+K)

1. Press Ctrl/Cmd+K
2. Full-screen overlay search opens
3. Type query: "psychic ads"
4. Results categorized: Items / Boards / Updates / Files / Users
5. Click result → navigate to it
6. Recent searches saved per user
7. AI semantic search (V2) — natural language: "tasks I'm working on this week"

---

## Flow 22: Create Dashboard

1. Sidebar → "+" Add new → Dashboard
2. Modal: "Create dashboard"
   - Name input
   - Privacy: Main / Private
3. Click "Create Dashboard"
4. Empty dashboard opens with prompt: "Connect boards" + "Add widget"
5. Click "Connect boards" → modal lists workspace boards → check → Done
6. Click "Add widget" → widget picker → choose type (Numbers, Chart, etc.)
7. Widget placed on grid (default position, default size)
8. Drag to reposition, drag corner to resize
9. Widget ... menu: Full screen, Settings, Rename, Duplicate, Dock, Delete

---

## Flow 23: Admin — Deactivate a User

1. Admin navigates to `/admin`
2. Users tab
3. Find user → ... menu → "Deactivate"
4. Confirm
5. Backend:
   - `users.status = 'deactivated'`
   - `users.deactivated_at = now()`
   - User's active sessions invalidated
   - Their content stays in place, avatar greyed
6. Their assigned tasks get ⚠️ "Reassign needed" indicator
7. Admin can reactivate from same menu

---

## Flow 24: Restore an Archived Board

1. Top-right board ... menu → "View archive / trash"
2. Archive page opens listing archived boards / items
3. Filter by type, date, owner
4. Click "Restore" → board moves back to workspace
5. Or click "Delete forever" → permanent

---

## Flow 25: Workspace Switch

1. Left sidebar workspace dropdown click
2. List of all workspaces user has access to
3. Click one → navigate to `/w/{slug}`
4. Sidebar updates to show that workspace's boards/folders

---

## Edge Cases & Error Handling Patterns

### Network errors
- Optimistic UI updates with rollback on failure
- Toast: "Update failed, retry" with retry button

### Permission denied
- Action attempted by viewer/guest → toast: "You don't have permission for this action"
- Hidden buttons preferred over disabled buttons where possible

### Conflict (two users editing same cell)
- Last-write-wins (Monday's behavior)
- Subtle indicator if another user is editing same item

### Empty states
- Empty board → "Add your first task" CTA
- Empty notifications → "You rock!" illustration
- Empty inbox → "All caught up!"
- Empty dashboard → "Add widgets to see data"

### Loading states
- Skeleton rows while data loads
- Spinner on button during async actions
- Progressive loading (groups load one at a time on big boards)

---

## Document Status

| Field | Value |
|---|---|
| **Version** | 0.1 |
| **Status** | Draft — 25 flows covered |
| **Open questions** | Forms flow + Automations flow → V2 doc |

---

> **Next doc:** `06-screens-and-layout.md` — every page, every component.
