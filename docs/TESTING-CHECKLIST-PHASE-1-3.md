# 🧪 PMS — Mid-Checkpoint Testing Guide (Phase 1-3)

> **Goal:** Verify foundation (auth, boards, tasks, columns) is rock-solid 
> before building Phase 4 on top of it.
> 
> **Time required:** 45-60 minutes for thorough testing
> **Skill needed:** None — just follow steps and note what fails

---

## 📊 Testing Strategy

We'll test in 6 sections:

| # | Section | Tests | Time |
|---|---|---|---|
| 1 | Authentication & Access Control | 12 | 10 min |
| 2 | Workspace & Profile | 6 | 5 min |
| 3 | Boards (CRUD + Permissions) | 14 | 10 min |
| 4 | Groups & Items | 10 | 8 min |
| 5 | Column Types (all 10) | 15 | 12 min |
| 6 | Drag-Drop, Bulk Actions, Subitems | 10 | 8 min |
| **TOTAL** | | **67 tests** | **~55 min** |

---

## ⚠ Before You Start

### Setup
1. Open Lovable preview in browser
2. **Logout** if logged in
3. Open browser DevTools → Console (F12) — watch for errors
4. Open a separate window for Supabase dashboard (optional, for DB checks)
5. Have this checklist open in another tab/window

### How to Use
- Test each item in order
- Mark ✅ if pass, ❌ if fail
- For failures, note:
  - What you did
  - What you expected
  - What happened
  - Console errors (if any)

### Reporting Bugs to Me
Use this format:
```
🐛 BUG #1
Section: [section name]
Test #: [test number]
Steps: [what you did]
Expected: [what should happen]
Actual: [what happened]
Console error: [if any]
Screenshot: [optional]
```

---

# 🔐 SECTION 1: AUTHENTICATION & ACCESS CONTROL

## Test 1.1 — Login Page Appearance
**Steps:** Open `/login` in browser
**Verify:**
- [ ] "PMS" text logo visible (large, brand blue)
- [ ] "Welcome back" subtitle
- [ ] **Username** field (NOT "Email")
- [ ] **Password** field with eye toggle
- [ ] "Remember me" checkbox (default checked)
- [ ] "Sign in" button (disabled when fields empty)
- [ ] "Need access? Contact your admin" text at bottom
- [ ] NO signup link anywhere
- [ ] NO forgot password link

## Test 1.2 — Login as pm1
**Steps:** Type `pm1` / `project123!` / Click Sign in
**Verify:**
- [ ] Loading state on button
- [ ] Redirects to `/` (workspace home)
- [ ] Top bar shows avatar with "P1" initials (or pm1's avatar)
- [ ] No console errors

## Test 1.3 — Wrong Password
**Steps:** Logout. Login as `pm1` with password `wrongpass`
**Verify:**
- [ ] Error message: "Username or password incorrect"
- [ ] Does NOT say which field is wrong (security)
- [ ] Inputs not cleared (so user can correct)

## Test 1.4 — Wrong Username
**Steps:** Login as `pmX` (non-existent) with any password
**Verify:**
- [ ] Same error: "Username or password incorrect"
- [ ] Same message, doesn't leak whether username exists

## Test 1.5 — Empty Inputs
**Steps:** Open login page, click Sign in without filling
**Verify:**
- [ ] Button is disabled, no error shown
- [ ] Type something in one field, button still disabled until both filled

## Test 1.6 — Password Visibility Toggle
**Steps:** Type password, click eye icon
**Verify:**
- [ ] Password becomes visible
- [ ] Click again → hidden
- [ ] Icon changes (eye ↔ eye-off)

## Test 1.7 — Login as pm2, pm3
**Steps:** Test login for each manager
**Verify:**
- [ ] pm2 / `project123!` works
- [ ] pm3 / `project123!` works
- [ ] Each shows correct user in top bar

## Test 1.8 — Master Admin Login (First Time)
**Steps:** Logout. Login as admin with your secret password
**Verify:**
- [ ] Forced password change modal appears
- [ ] Modal CANNOT be dismissed (no X, ESC doesn't close it)
- [ ] Has fields: Current password, New password, Confirm
- [ ] Shows password requirements
- [ ] Cancel/skip button NOT present

## Test 1.9 — Forced Password Change
**Steps:** Enter current password + new password (e.g., `NewSecure123!`) + confirm
**Verify:**
- [ ] Validation: new password must meet requirements
- [ ] Confirm mismatch shows error
- [ ] On success: modal closes, redirects to `/`
- [ ] Next login uses new password (test by logging out)

## Test 1.10 — Direct URL Access Without Login
**Steps:** Logout. Type `/` in URL directly. Press Enter.
**Verify:**
- [ ] Redirects to `/login?redirect=/`
- [ ] After login, redirects back to `/`

**Then test:**
- [ ] `/admin` → redirects to `/login?redirect=/admin`
- [ ] `/profile` → redirects to `/login?redirect=/profile`
- [ ] `/w/main/b/xyz` → redirects to login

## Test 1.11 — Already Logged In Trying /login
**Steps:** Login as pm1. Manually type `/login` in URL.
**Verify:**
- [ ] Redirects to `/` immediately (doesn't show login page)

## Test 1.12 — Admin-Only Route as Non-Admin
**Steps:** Login as pm1. Manually type `/admin` in URL.
**Verify:**
- [ ] Redirects to `/`
- [ ] Toast appears: "Admin access required"

---

# 🏠 SECTION 2: WORKSPACE & PROFILE

## Test 2.1 — Workspace Home Layout
**Steps:** Login as any user. Should be at `/`
**Verify:**
- [ ] Big workspace icon at top (🏠 or whatever was set)
- [ ] "Main workspace" name
- [ ] 3 tabs: Recents / Content / Collaborators
- [ ] Recents tab active by default

## Test 2.2 — Collaborators Tab
**Steps:** Click "Collaborators" tab
**Verify:**
- [ ] Shows all 4 users: admin, pm1, pm2, pm3
- [ ] Each card has: avatar, full name, role badge, @username
- [ ] Role badges colored: admin=blue/distinctive, manager=purple
- [ ] NO email visible anywhere
- [ ] Grid layout (3-4 per row on desktop)

## Test 2.3 — Edit Workspace (Admin Only)
**Steps:** As admin, click Edit button. As pm1, see if button exists.
**Verify:**
- [ ] Admin sees Edit button → modal opens with name/icon/color
- [ ] pm1 does NOT see Edit button (or sees but disabled)

## Test 2.4 — Profile Page
**Steps:** Click avatar → My Profile (or navigate to `/profile`)
**Verify:**
- [ ] Big avatar at top
- [ ] Full name + title
- [ ] Username (@username), Role badge, Joined date, Last active, Timezone, Theme
- [ ] **NO email field visible**
- [ ] Change Password button

## Test 2.5 — Change Own Password
**Steps:** Click Change Password
**Verify:**
- [ ] Modal: current password, new, confirm
- [ ] Validates: min 8 chars, contains number, contains letter
- [ ] On success: toast "Password updated"
- [ ] Can login with new password

## Test 2.6 — Theme Toggle Persistence
**Steps:** Toggle theme via avatar dropdown. Logout. Login.
**Verify:**
- [ ] Theme switches immediately
- [ ] After logout/login, theme is preserved
- [ ] Check Supabase: `users.theme` updated for this user

---

# 📋 SECTION 3: BOARDS (CRUD + PERMISSIONS)

## Test 3.1 — Sidebar Initial State
**Steps:** Fresh login as pm1. Look at left sidebar.
**Verify:**
- [ ] "Main workspace" with icon at top
- [ ] "Workspace home" link (active when on /)
- [ ] If no boards exist yet: just shows workspace home
- [ ] "+ Add new" button at bottom (visible to pm1 — managers can create)

## Test 3.2 — Create First Board
**Steps:** Click "+ Add new" → Board
**Verify:**
- [ ] Modal opens "Create a new board"
- [ ] Required: name field
- [ ] Optional: description (textarea)
- [ ] Board type radio: Main (default) / Private
- [ ] Icon emoji picker
- [ ] Create button disabled when name empty

## Test 3.3 — Create Board "Team Tasks"
**Steps:** Name: "Team Tasks", Type: Main, Create
**Verify:**
- [ ] Modal closes
- [ ] Toast "Board created" (or similar)
- [ ] Redirects to `/w/main/b/{id}` (board page)
- [ ] Board appears in sidebar
- [ ] Board page shows:
  - Header with "Team Tasks" name, default icon
  - "Add description..." placeholder
  - 1 default group "Group Title"
  - 5 default columns: Task, Status, Owner, Date, Priority
  - "+ Add task" inline at bottom of group
  - "+ Add new group" at bottom

## Test 3.4 — Default Labels Check
**Steps:** Click Status cell on the (if any task exists, or visually inspect)
**Verify:**
- [ ] Status labels: Not Started (grey), Working on it (orange), Done (green), Stuck (red)
- [ ] Priority labels: Low, Medium, High, Critical (each different color)
- [ ] "Not Started" is default for Status
- [ ] "Low" is default for Priority

## Test 3.5 — Inline Rename Board
**Steps:** Click on board name in header
**Verify:**
- [ ] Becomes editable, text selected
- [ ] Type new name + Enter → saves
- [ ] Sidebar updates immediately
- [ ] ESC reverts
- [ ] Empty name shows error/reverts

## Test 3.6 — Board Description
**Steps:** Click "Add description..." in header
**Verify:**
- [ ] Becomes editable
- [ ] Type description + blur/Enter → saves
- [ ] Persists on refresh

## Test 3.7 — Favorite Board
**Steps:** Click star icon on board header
**Verify:**
- [ ] Star fills in
- [ ] "Favorites" section appears in sidebar with this board
- [ ] Click again → unfavorites, section disappears

## Test 3.8 — Create Private Board (as pm1)
**Steps:** + Add new → Board → "PM1 Secret" → Private → Create
**Verify:**
- [ ] Board created
- [ ] Visible in pm1's sidebar
- [ ] Has all defaults (group + columns)

## Test 3.9 — Private Board Permissions
**Steps:** Logout pm1. Login pm2.
**Verify:**
- [ ] pm2 sees "Team Tasks" (main board)
- [ ] pm2 does NOT see "PM1 Secret" (private board)
- [ ] Try direct URL `/w/main/b/{pm1_secret_id}` → 403 or redirect

## Test 3.10 — Admin Sees All
**Steps:** Logout pm2. Login admin.
**Verify:**
- [ ] Admin sees BOTH "Team Tasks" AND "PM1 Secret"

## Test 3.11 — Archive Board
**Steps:** As admin, board ⋯ menu → Archive → confirm
**Verify:**
- [ ] Confirmation dialog shows
- [ ] After confirm: board removed from sidebar
- [ ] Toast "Board archived"
- [ ] DB check: archived_at is set, deleted_at still null

## Test 3.12 — Delete Board
**Steps:** Create a test board, then ⋯ → Delete
**Verify:**
- [ ] Strong confirmation dialog (type board name to confirm)
- [ ] After confirm: board removed from sidebar
- [ ] Toast "Board deleted"

## Test 3.13 — Recents Tab
**Steps:** Visit a few boards. Go to workspace home → Recents.
**Verify:**
- [ ] Shows recently visited boards
- [ ] Most recent first
- [ ] Each card: icon, name, "Last viewed: X ago"
- [ ] Click → opens board

## Test 3.14 — Content Tab
**Steps:** Workspace home → Content tab
**Verify:**
- [ ] Shows all accessible boards in table
- [ ] Columns: Name, Type, Owner, Created, Updated, Actions
- [ ] Search box filters live

---

# 📁 SECTION 4: GROUPS & ITEMS

## Test 4.1 — Add New Group
**Steps:** On a board, click "+ Add new group"
**Verify:**
- [ ] Inline input appears, focused
- [ ] Type "Important" + Enter → group created
- [ ] Random color from palette
- [ ] Color bar on left

## Test 4.2 — Rename Group
**Steps:** Click group name
**Verify:**
- [ ] Becomes editable
- [ ] Type + Enter → saves
- [ ] ESC reverts

## Test 4.3 — Change Group Color
**Steps:** Click color bar or ⋯ → Change color
**Verify:**
- [ ] Color palette popup
- [ ] Click color → group color updates
- [ ] Color bar reflects change

## Test 4.4 — Collapse/Expand Group
**Steps:** Click ▼/▶ arrow on group header
**Verify:**
- [ ] Collapse hides items
- [ ] Expand shows them
- [ ] State persists on page refresh

## Test 4.5 — Delete Group
**Steps:** Group ⋯ → Delete
**Verify:**
- [ ] Confirmation (warns about items if has them)
- [ ] On confirm: group removed
- [ ] Items in group also archived (cascade)

## Test 4.6 — Add Task Inline
**Steps:** Click "+ Add task" in any group
**Verify:**
- [ ] First cell (Task name) becomes input, focused
- [ ] Type "First task" + Enter
- [ ] Row created with task name
- [ ] Task code auto-filled (e.g., "Task 1")
- [ ] Default status: "Not Started" (or empty)
- [ ] Another "+ Add task" row appears below

## Test 4.7 — Rename Task
**Steps:** Click task name cell
**Verify:**
- [ ] Becomes editable, text selected
- [ ] Type new name + Enter → saves
- [ ] Tab → moves to next cell

## Test 4.8 — Task Counter
**Steps:** Create 3 tasks
**Verify:**
- [ ] Codes: Task 1, Task 2, Task 3
- [ ] Codes never reuse (delete Task 2, add new → Task 4, not Task 2)

## Test 4.9 — Group Task Count
**Steps:** Look at group header
**Verify:**
- [ ] Shows count of items in group (e.g., "3")
- [ ] Updates live when adding/deleting

## Test 4.10 — Empty State
**Steps:** Delete all tasks in a group
**Verify:**
- [ ] Just "+ Add task" remains
- [ ] No broken UI

---

# 🎨 SECTION 5: COLUMN TYPES

For each column type, create a task and try to set the value. Verify display + edit work.

## Test 5.1 — Task Name (always first, non-deletable)
**Verify:**
- [ ] Larger font, weight 500
- [ ] Cannot delete this column
- [ ] Cannot change type
- [ ] Always position 0

## Test 5.2 — Status
**Steps:** Click Status cell on a task
**Verify:**
- [ ] Label picker dropdown opens
- [ ] 4 labels visible (Not Started, Working, Done, Stuck)
- [ ] Click "Done" → cell becomes green "Done" pill
- [ ] Cell fills entirely with label color

## Test 5.3 — Edit Labels Modal
**Steps:** Click Status → "Edit Labels" link
**Verify:**
- [ ] Modal opens with all labels in grid
- [ ] Each label: pill + 🎨 + ✏ + ⋯
- [ ] "+ New label" button works
- [ ] Drag-reorder works
- [ ] Color picker works
- [ ] Rename inline works
- [ ] Set default works
- [ ] Delete with confirmation
- [ ] Apply saves all changes

## Test 5.4 — People Column
**Steps:** Click Owner cell
**Verify:**
- [ ] User picker dropdown opens
- [ ] Search at top
- [ ] List shows all 4 users (avatar + name + @username)
- [ ] Click user → avatar appears in cell
- [ ] Multi-select: click another → both avatars in cell
- [ ] Remove user: click ✕ in cell or uncheck in dropdown

## Test 5.5 — Date Column
**Steps:** Click Date cell
**Verify:**
- [ ] Date picker opens
- [ ] Month/year nav
- [ ] Calendar grid
- [ ] "Today" button
- [ ] "Clear" link
- [ ] Click date → cell shows formatted date
- [ ] Today highlighted with special style

## Test 5.6 — Priority Column
**Verify:** (similar to Status)
- [ ] 4 labels: Low/Medium/High/Critical
- [ ] Click → picker → select → pill displays

## Test 5.7 — Add Numbers Column
**Steps:** + Add column → Numbers
**Verify:**
- [ ] Column added, auto-focused for rename
- [ ] Click cell → numeric input
- [ ] Type "100" + Enter → displays
- [ ] Settings: change unit prefix to "$" → "$100" displays
- [ ] Right-aligned in cell

## Test 5.8 — Add Checkbox Column
**Steps:** + Add column → Checkbox
**Verify:**
- [ ] Column added
- [ ] Click cell → toggles ☐ ↔ ☑
- [ ] Center-aligned

## Test 5.9 — Add Dropdown Column
**Steps:** + Add column → Dropdown, name it "Tags", add 3 labels
**Verify:**
- [ ] Multi-select picker
- [ ] Selected labels show as pills in cell (wrap if many)
- [ ] Click cell → uncheck/check
- [ ] Search filters labels

## Test 5.10 — Add Link Column
**Steps:** + Add column → Link
**Verify:**
- [ ] Click cell → small form: URL + Display text
- [ ] Save → cell shows link icon + display text
- [ ] Click link → opens new tab

## Test 5.11 — Text Column
**Steps:** + Add column → Text
**Verify:**
- [ ] Click cell → text input
- [ ] Type → save on blur or Enter
- [ ] Long text truncates with tooltip on hover

## Test 5.12 — Column Resize
**Steps:** Hover right edge of column header
**Verify:**
- [ ] Cursor changes to col-resize
- [ ] Drag → width changes live
- [ ] Release → saves width

## Test 5.13 — Column Reorder
**Steps:** Drag column header to new position
**Verify:**
- [ ] Drop indicator line shows
- [ ] Columns rearrange
- [ ] Cannot move task_name column (locked)

## Test 5.14 — Hide Columns
**Steps:** Toolbar → 👁 Hide → uncheck a column
**Verify:**
- [ ] Column hidden from view
- [ ] Data preserved (not deleted)
- [ ] Check again → column reappears

## Test 5.15 — Delete Column
**Steps:** Column header ⋯ → Delete (try Numbers column)
**Verify:**
- [ ] Confirmation: "This will delete this column and N values"
- [ ] On confirm: column gone, values cleared
- [ ] Cannot delete task_name (option disabled)

---

# 🚀 SECTION 6: DRAG-DROP, BULK ACTIONS, SUBITEMS

## Test 6.1 — Drag Task Within Group
**Steps:** Drag a task row by handle
**Verify:**
- [ ] Drop indicator line between rows
- [ ] Drop changes order
- [ ] Refresh → order persists

## Test 6.2 — Drag Task Between Groups
**Steps:** Drag task from Group A to Group B
**Verify:**
- [ ] Drop indicator in target group
- [ ] Task moves
- [ ] group_id updated in DB
- [ ] All column values preserved

## Test 6.3 — Drag Groups
**Steps:** Drag group header
**Verify:**
- [ ] Drop indicator between groups
- [ ] Groups reorder
- [ ] Persists on refresh

## Test 6.4 — Drag Columns
**Steps:** Drag column header
**Verify:**
- [ ] Drop indicator between columns
- [ ] Columns reorder
- [ ] task_name cannot move

## Test 6.5 — Bulk Select Tasks
**Steps:** Check 3 tasks via checkboxes
**Verify:**
- [ ] Floating action bar appears at bottom
- [ ] Shows "3 Tasks selected"
- [ ] Buttons: Duplicate, Archive, Delete, Move to, ✕

## Test 6.6 — Bulk Archive
**Steps:** Select 2 tasks → Archive
**Verify:**
- [ ] Both removed from view
- [ ] Toast confirms
- [ ] DB: archived_at set for both

## Test 6.7 — Bulk Move
**Steps:** Select tasks → Move to → choose group
**Verify:**
- [ ] Tasks moved to target group
- [ ] Original group count decreases

## Test 6.8 — Add Subitem
**Steps:** Click ▶ on a task → "+ Add subitem"
**Verify:**
- [ ] Inline subitem row appears (indented)
- [ ] Type name + Enter
- [ ] Task code: parent code + "-A"
- [ ] Parent task shows subitem count

## Test 6.9 — Subitem Codes
**Steps:** Add 3 subitems
**Verify:**
- [ ] Codes: parent-A, parent-B, parent-C

## Test 6.10 — Collapse Subitems
**Steps:** Click ▼ to collapse parent
**Verify:**
- [ ] Subitems hidden
- [ ] Parent row still shows subitem count

---

# 🎯 TOOLBAR FUNCTIONALITY QUICK TESTS

## Test 7.1 — Search
- [ ] Toolbar search filters tasks live
- [ ] Shows "Showing X of Y" count
- [ ] Clear (×) resets

## Test 7.2 — Person Filter
- [ ] Quick person filter dropdown
- [ ] Multi-select users
- [ ] Filters tasks to those assigned

## Test 7.3 — Sort
- [ ] Sort dropdown works
- [ ] Multi-level sort
- [ ] Asc/desc per column

## Test 7.4 — Group By
- [ ] Choose Status → tasks regroup by status labels

---

# 🌗 SECTION 8: VISUAL POLISH (Quick Pass)

## Test 8.1 — Light/Dark Mode
**Steps:** Toggle theme on various pages
**Verify:**
- [ ] Login: looks good both modes
- [ ] Workspace home: good both
- [ ] Board page: good both
- [ ] Modals: good both
- [ ] No invisible text (contrast)

## Test 8.2 — Loading States
**Verify:**
- [ ] Skeleton rows while data loading
- [ ] Spinner on buttons during async
- [ ] No content flashes (white → real)

## Test 8.3 — Hover States
**Verify:**
- [ ] Buttons have hover effect
- [ ] Rows highlight on hover
- [ ] Icons show tooltips

## Test 8.4 — Empty States
**Verify:**
- [ ] Empty board: helpful CTA
- [ ] Empty group: just "+ Add task"
- [ ] Empty Recents: helpful message

---

# 📊 RESULTS SUMMARY

After testing, fill this in:

| Section | Pass / Total | Critical Bugs |
|---|---|---|
| 1. Auth | __ / 12 | |
| 2. Workspace & Profile | __ / 6 | |
| 3. Boards | __ / 14 | |
| 4. Groups & Items | __ / 10 | |
| 5. Column Types | __ / 15 | |
| 6. Drag-Drop & Bulk | __ / 10 | |
| Quick: Toolbar | __ / 4 | |
| Quick: Visual | __ / 4 | |
| **TOTAL** | __ / 75 | |

---

# 🎯 PRIORITY OF FIXES

When you report bugs, I'll fix in this order:

**🔴 CRITICAL (must fix before Phase 4):**
- Auth bypass
- Permission leaks (private board showing to wrong user)
- Data loss (changes not persisting)
- App crashes

**🟡 HIGH (fix before Phase 4 if possible):**
- Wrong UI (looks bad)
- Wrong behavior (works but wrong way)
- Missing features from spec

**🟢 LOW (can defer):**
- Minor visual tweaks
- Tooltip improvements
- Polish items

---

# ✅ DECISION POINTS

After testing complete:

1. **If 90%+ pass + no critical bugs** → Proceed to Phase 4
2. **If 75-90% pass with critical bugs** → Fix critical bugs first, then Phase 4
3. **If <75% pass** → Major fix prompt needed before continuing

---

> **Ready when you are. Test, report, fix, then Phase 4.**
