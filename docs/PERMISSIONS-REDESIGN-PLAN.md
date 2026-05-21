# 🔐 PMS — Permissions Redesign Plan (CORRECTED FLOW)

> The original flow was wrong. This document defines the CORRECT permission
> model based on how the system is actually used.

---

## 🎯 THE REAL MODEL (Simple)

There are only **TWO roles**:

### 1. Master Admin (only 1 — `admin`)
The owner/boss. Full control over everything.

### 2. Manager (= employee)
A worker. Very limited. Just does assigned work and reports status.

**Remove the "Viewer" role entirely** (it was never needed).

---

## 👑 ADMIN — Can Do Everything

- Create / rename / archive / delete boards
- Create / edit / delete groups, columns, labels (full board structure)
- Create / edit / delete tasks and subitems
- Edit ALL cell values (status, people, dates, everything)
- **Invite managers to specific boards** (invite link system — admin only)
- See ALL boards (every manager's board)
- Manage users (admin panel: add/reset/deactivate/role)
- Set Gemini key, all settings
- Comment / updates everywhere

Admin = unrestricted.

---

## 👷 MANAGER (Employee) — Very Limited

A manager is just an employee who logs in to see their assigned work
and update progress. Think of them like a worker checking their task
list, NOT a project manager.

### Manager CAN:
- ✅ Log in
- ✅ See ONLY the board(s) they've been invited/assigned to
- ✅ Open tasks, read all task details
- ✅ **Change the Status** of their tasks (e.g. Not Started → Working on it → Done)
- ✅ Post comments / updates (the "Read instruction" message area)
- ✅ See subitems, files, activity on their tasks
- ✅ Toggle their own theme, change own password

### Manager CANNOT:
- ❌ Create a new board
- ❌ Create / rename / delete groups
- ❌ Create / rename / resize / delete columns
- ❌ Add / delete / rename tasks
- ❌ Edit cell values OTHER than Status (no editing task name, dates,
     numbers, people, etc.)
- ❌ Edit / manage labels
- ❌ Invite anyone
- ❌ See ANY other manager's board
- ❌ Archive / delete / favorite-manage boards (admin's job)
- ❌ Access the admin panel
- ❌ Drag-reorder tasks/groups/columns

So a manager's board is essentially **read-only EXCEPT**:
- Status column → editable
- Comments/updates → can post

### Multiple boards
- A manager CAN be assigned to **multiple boards** (admin invites them
  to each one separately).
- They see all boards they're assigned to in their sidebar, nothing else.

---

## 👁 OWNERSHIP FIELD — HIDE, don't remove

- The "Owner" / ownership column and the board-owner meta (e.g. "Owner
  @pm1") should be **HIDDEN from the UI**, not deleted from the database.
- Keep the data/columns in the schema (admin logic + future use), just
  don't show it on screen.
- Reason: the concept of "owner" confuses the simple admin→employee model.

---

## 🔒 PRIVACY — Managers isolated

- Manager A must NEVER see Manager B's board.
- Enforced at the database level (RLS), not just hidden in UI.
- A manager only sees a board if the admin explicitly assigned/invited
  them to it (via board_subscribers).

---

## 🔄 WHAT CHANGES FROM CURRENT BUILD

### Database / RLS
1. Drop "viewer" from the allowed roles (or just stop using it — keep
   admin + manager). Existing managers stay managers.
2. Tighten RLS so managers:
   - SELECT boards: only boards they're subscribed to (already mostly
     true for private boards — make ALL boards effectively private to
     non-admins; managers never see boards they aren't subscribed to,
     even "main" boards).
   - CANNOT INSERT/UPDATE/DELETE boards, groups, columns, labels.
   - CANNOT INSERT/DELETE items (tasks).
   - CAN UPDATE items ONLY on the Status column's value (item_column_values
     where the column is the status column). All other cell edits blocked
     for managers at the RLS layer.
   - CAN INSERT updates/comments and reactions.
3. Admin keeps full access (unchanged).

### Frontend (UI gating)
1. Hide from managers: New task button, + Add task rows, + Add column,
   + Add group, add-new-board, archive/delete/favorite board controls,
   group/column ⋯ menus, drag handles, Invite button (admin only),
   labels editor, bulk action bar.
2. Make all cells read-only for managers EXCEPT the Status cell, which
   stays clickable/editable.
3. Keep comments/updates composer enabled for managers.
4. Hide the Owner column and "Owner @username" board meta for everyone
   (data stays in DB).
5. Sidebar for managers shows only their assigned boards (no "+ Add new").
6. Invite button visible to admin only.

### Roles cleanup
- Remove viewer option from the admin "Add user" form (only Manager).
- Remove viewer/editor options from the Invite modal (invite = manager
  to a specific board). Admin is never invited (only 1, seeded).

---

## ✅ END STATE

- **Admin**: builds everything, invites managers to boards, sees all.
- **Manager**: logs in, sees only their assigned boards, reads tasks,
  changes Status, posts comments. Nothing else.
- **Owner field**: hidden everywhere (kept in DB).
- **Privacy**: managers fully isolated from each other (RLS-enforced).
- **Invite**: admin-only, assigns a manager to a specific board.

---

## 🛠 BUILD ORDER (for Claude Code)

1. RLS first (the security layer — most important):
   - Managers: read-only except Status value + comments.
   - Managers see only subscribed boards.
   - Verify by testing as a manager directly (cannot insert task,
     cannot edit name, CAN change status, CAN comment).
2. Frontend gating (hide all the controls managers shouldn't see/use;
   make non-status cells read-only for managers).
3. Hide Owner column + board owner meta globally.
4. Clean up role options (drop viewer from add-user + invite).
5. Test both roles end-to-end, update docs/TEST-REPORT.md.

---

> This corrects the core flow. Admin = full power. Manager = an employee
> who only views assigned work, updates Status, and comments.

---

# 🆕 ADDENDUM — Additional Features & Fixes (from Monday analysis)

> Added after reviewing real Monday screenshots (label editor, invite,
> status picker) plus user's new requirements.

## A. ADMIN — New Capabilities

### A1. Invite manager to a SPECIFIC GROUP (not just whole board)
- When admin invites/assigns a manager, allow scoping to:
  - the whole board, OR
  - a specific group within the board
- If assigned to a group only, the manager sees ONLY that group's tasks
  on that board (other groups hidden), and can still only change Status
  + comment within it.
- Store the group scope on the assignment (board_subscribers gets an
  optional group_id, or a parallel table). Enforce via RLS.

### A2. Duplicate board / group (admin only)
- Admin can DUPLICATE a board → creates a full copy (groups, columns,
  labels, tasks, cell values) with a new name like "Copy of X".
- Admin can DUPLICATE a group within a board → copies the group + its
  tasks + their cell values into the same board.
- After duplicating, admin can edit/delete the copy freely (it's a
  normal board/group).
- Implement as a server-side function (SECURITY DEFINER) so the deep
  copy is atomic and respects ownership.

## B. LABELS — Make creation EASY (currently broken)

Match Monday's label editor (see screenshots):
- The status/label picker dropdown shows the colored label grid with an
  "Edit Labels" link at the bottom (Image 1).
- The label editor (Image 3) shows: a grid of existing labels (each a
  colored chip with its name, editable inline, with a color swatch to
  recolor), an empty "Add Label" slot, a "+ New label" button, and an
  "Apply" button at the bottom.
- FIX: "Add label" / "+ New label" currently does NOT work — make it
  work. Adding a new label should be very easy: click + New label →
  type a name → pick a color → it's added immediately. No friction.
- Admin can rename, recolor, reorder, delete labels easily.
- This applies to status, priority, and dropdown columns.

## C. SCROLLBAR FIX (repeat of earlier issue)

- There must be ONE horizontal scrollbar at the PAGE/table level on the
  x-axis — NOT a separate scrollbar per group or per task/section.
- Headers + all group rows scroll together as one unit, column-aligned.
- The scrollbar should be CUSTOM-STYLED (slim, rounded, subtle) like the
  reference image the user provided — not the default chunky browser bar.
- No vertical scrollbars inside individual groups; the page scrolls
  vertically as a whole.

## D. ADMIN SETTINGS — KEEP AS IS

- Do NOT remove the admin settings (Gemini API key section, user
  management, etc.). Admin side is fine — only fix the specific issues
  listed. Leave all admin settings/features in place.

## E. INVITE MODAL (match Monday style — Image 2)

- Clean modal "Invite to this board", search field, list of people
  already invited with a remove (×) option and a crown on the owner/admin.
- But per OUR model: invite generates a link (no email system) and is
  admin-only, scoped to board or group (see A1).

---

## 🛠 UPDATED BUILD ORDER

1. Permissions RLS (admin full / manager status+comment only / isolated).
2. Fix label add/create (make it work + easy, Monday-style editor).
3. Frontend gating (hide manager controls, non-status cells read-only).
4. Hide Owner column + board owner meta (keep in DB).
5. Invite scoped to board OR specific group (admin only, link-based).
6. Duplicate board + duplicate group (admin, server-side deep copy).
7. Scrollbar fix (single page-level x-axis, custom-styled).
8. Drop viewer role from add-user + invite.
9. Test both roles end-to-end, update docs/TEST-REPORT.md.

(Keep all admin settings — Gemini key, user mgmt — untouched.)
