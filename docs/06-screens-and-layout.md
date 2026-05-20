# 🖼️ PMS — Screens & Layout

> **Document 6 of 9** — Every page, what's on it, what components.

---

## Global Layout (Most Pages)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  TOP BAR (dark)                                                          │
│  [Logo] [PageContext]  [────── Search (Ctrl+K) ──────]  [🔔📥👥🧩❓⊞👤]    │
├──────────┬──────────────────────────────────────────────────────────────┤
│          │                                                              │
│ ICON RAIL│  CONTENT AREA                                                │
│ (60px)   │  (page-specific)                                             │
│          │                                                              │
│ Workspace│                                                              │
│ Agents   │                                                              │
│ Vibe     │                                                              │
│ Notetaker│                                                              │
│ Favorites│                                                              │
│ More     │                                                              │
├──────────┴──────────────────────────────────────────────────────────────┤
```

Most board/dashboard pages also have a **left workspace panel** (~250px) between the icon rail and content area, showing the current workspace's items.

---

## Page 1: Login (`/login`)

Simple centered card.
- Logo at top
- "Welcome back" heading
- Email input
- Password input
- "Forgot password?" link
- "Sign in" button (primary)
- "Don't have an account? Contact your admin." (no public signup)

---

## Page 2: Signup with Invite Token (`/signup?token=xyz`)

- Logo
- "Complete your account" heading
- Email (pre-filled, disabled)
- Full Name input
- Password input
- Confirm password input
- "Create account" button

---

## Page 3: Forgot / Reset Password

- Logo
- Either "Reset your password" (request) or "Choose a new password" (after click)
- Email or password input
- Submit button

---

## Page 4: Account Home (`/`)

When user logs in, redirects to default workspace home.

Layout: Global layout + workspace panel + content = **Workspace Home (Recents tab)**.

---

## Page 5: Workspace Home (`/w/{slug}`)

Captured from Image 13.

```
┌──────────────────────────────────────────────────────────────────────┐
│ [Icon:Big]   {Workspace Name}  [▼ switcher]    [💬 Feedback]         │
│              Add workspace description...      [🤖 Agents] [Members] │
│                                                [...]                 │
├──────────────────────────────────────────────────────────────────────┤
│ Tabs:   🕐 Recents    📄 Content    👥 Collaborators    🔒 Permissions│
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  TAB CONTENT (changes per tab)                                       │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Tab: Recents
List of recently viewed boards/docs/dashboards, sorted by last visit per user.

### Tab: Content
- Search + Filters
- Cleanup mode toggle
- Table of all assets: Name | AI Summary | Creator | Created | Last Modified
- Bulk select to archive/delete

### Tab: Collaborators
- **AI Agents** section (Image 14)
- Workspace members list
- Add new agent button

### Tab: Permissions
- Workspace privacy settings
- Member management with roles
- Defaults for new boards in this workspace

---

## Page 6: Board (`/w/{ws}/b/{board}`)

The most important page. Captured extensively in screenshots.

```
┌──────────────────────────────────────────────────────────────────────┐
│ {Board Name} ▼   ✨AI suggestions  🧩Integrate  ⚡Automate  💬  [Avatars] [Invite/1] [🔗] [...]│
│                                                                      │
│ Tabs:  Main table ⋯   💗 Build Vibe view   Kanban ⋯   +              │
├──────────────────────────────────────────────────────────────────────┤
│ [+New task▼]   🔍Search  👤Person  🔽Filter▼  ↕Sort  👁Hide  📁Group by  ⋯  [▲]│
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ▼ Team Red Projects                                                 │
│  ┌──┬───────────────────┬──────┬─────────┬───────────────┬─────────┐│
│  │☐ │ Task              │ Code │ Status  │ Task Type     │ ...     ││
│  ├──┼───────────────────┼──────┼─────────┼───────────────┼─────────┤│
│  │☐ │ Read Instruction  │ T1   │ Working │ Human & Co-Work│ ...    ││
│  │☐ │ Prompt For Co Work│ T2   │ Not St. │ Task Req AI Co │ ...    ││
│  │  │ + Add task        │      │         │               │         ││
│  └──┴───────────────────┴──────┴─────────┴───────────────┴─────────┘│
│  (column footer summaries)                                           │
│                                                                      │
│  ▶ Task for Axel Rose (12 tasks — collapsed)                         │
│                                                                      │
│  ▶ Completed Task (9 tasks — collapsed)                              │
│                                                                      │
│  [+ Add new group]                                                   │
└──────────────────────────────────────────────────────────────────────┘
```

### Components per row
- Drag handle (on hover, left)
- Checkbox
- Expand arrow ▶ (if has subitems)
- Open task page icon ⤢ (on hover)
- Each cell: colored pill / text / icon based on column type
- Comments icon with count

### Column footer
At bottom of each group's columns:
- Status column: distribution bar (color segments)
- Numbers column: sum / average / count
- Files column: total file count
- People column: avatar stack

### Floating action bar
When 1+ rows selected:
- Bottom-center floating bar
- "{N} Task selected" + actions: Duplicate, Export, Archive, Delete, Convert, Move to, Sidekick, Apps, ✕

---

## Page 7: Board with Task Panel Open (`/w/{ws}/b/{board}/p/{item_id}`)

Same board view, but **right 50-55% becomes the task panel**.

```
┌─────────────────────────────┬─────────────────────────────────────┐
│ Board (compressed)          │ ✕ {Task Name}      👤💬⋯            │
│ ──────────────────────      ├─────────────────────────────────────┤
│ ▼ Team Red Projects         │ Updates/1 | Files | Activity | Vibe+│
│ ☐ Read Instruction (active) │ ─────────────────────────────────── │
│ ☐ Prompt For Co Work        │                                     │
│ ☐ Your Personal Computer    │ TAB CONTENT                         │
│ ...                         │                                     │
│                             │                                     │
└─────────────────────────────┴─────────────────────────────────────┘
```

### Slide-in panel structure
- Top bar: ✕ close, task name (editable), 👤 owner avatar, 💬, ⋯
- Tabs row (Updates / Files / Activity Log / Build Vibe view / +)
- Tab content fills remaining height

### Active row indicator
- The row corresponding to open task is highlighted (light blue) in board

---

## Page 8: Full Task Page (`/w/{ws}/b/{board}/p/{item_id}/full`)

Standalone page — no compressed board.

> **Note:** This page wasn't directly captured but is based on Monday's standard full-page task layout. Will refine after first build pass.

```
┌──────────────────────────────────────────────────────────────────────┐
│ ← Back to board   {Task Name (editable)}                  [⋯ menu]   │
│                                                                      │
│  Owner: [Avatar pill]    [📌 Star]  [🔔 Subscribe]                   │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ FIELDS ZONE — All columns visible as editable pills/inputs     │  │
│  │                                                                │  │
│  │ Task Code:   [Task 11]                                         │  │
│  │ Status:      [Working on it ▼]                                 │  │
│  │ Task Type:   [Human & Co-Work ▼]                               │  │
│  │ Co-Work Time:[5-10 minutes ▼]                                  │  │
│  │ Priority:    [High ▼]                                          │  │
│  │ Date:        [05/19/2026 ▼]                                    │  │
│  │ Timeline:    [Apr 1 → Apr 30]                                  │  │
│  │ Person:      [Avatar1 Avatar2 +]                               │  │
│  │ Files:       [📎 3 files]                                      │  │
│  │ Last Updated:[By Admin · 2h ago]                               │  │
│  │ Created:     [By Arslan · Apr 1]                               │  │
│  │ + Show more fields ▼                                           │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ▼ Subitems (3)                                                      │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ ☐ Subitem A      [Status]  [Date]   [Person]                 │    │
│  │ ☐ Subitem B      [Status]  [Date]   [Person]                 │    │
│  │ ☐ Subitem C      [Status]  [Date]   [Person]                 │    │
│  │ + Add subitem                                                │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  Tabs: Updates(2) | Files(3) | Activity Log | Vibe view | +          │
│  ─────────────────────────────────────────────────                   │
│                                                                      │
│  TAB CONTENT                                                         │
│  (same components as slide-in panel, just full-width)                │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Fields zone layout details
- **2-column grid** on wide screens, 1-column on narrow
- Each field row: label (left, 120px width, secondary text) + value pill (right, editable)
- Empty fields show "+ Add" placeholder
- Click any value → opens inline editor (matches table cell behavior)
- "Show more fields" expands less common ones (auto fields, custom columns)

### Subitems section
- Inline table view of subitems
- Subset of parent's columns (configured per board)
- + Add subitem button
- Each subitem is clickable → opens its own task page

### Tab behavior
- Same tabs as slide-in panel
- Tab content fills full page width (more room than panel)
- Sticky tab bar when scrolling

---

## Page 9: Kanban View

Captured from Image 5, 6.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Board header (same as Page 6)                                        │
├──────────────────────────────────────────────────────────────────────┤
│ 🔍 Search  👤 Person  🔽 Filter  ↕ Sort  ⋯       [color bars] ⬆ ⚙ 💬 ▲│
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ │
│ │ DONE     15  │ │ WORKING ON 3 │ │ STUCK     2  │ │ NOT STARTED  │ │
│ ├──────────────┤ ├──────────────┤ ├──────────────┤ ├──────────────┤ │
│ │ [Card]       │ │ [Card]       │ │ [Card]       │ │ [Card]       │ │
│ │ [Card]       │ │ [Card]       │ │              │ │ [Card]       │ │
│ │ [Card]       │ │              │ │              │ │              │ │
│ │ + Add task   │ │ + Add task   │ │ + Add task   │ │ + Add task   │ │
│ └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### Card structure
```
┌─────────────────────────────┐
│ Task Name                 ✏⋯│
│ Task Code                   │
│ [Status pill]               │
│ [Type pill]                 │
│ [Time pill]                 │
│ 💬 1                  📋 2  │
└─────────────────────────────┘
```

### Widget settings panel (right side, optional)
- Customize card columns
- Toggle: show column name, display cover image
- Customize Task vs Sub-task cards separately

---

## Page 10: Calendar View

```
┌──────────────────────────────────────────────────────────────────────┐
│ Board header                                                         │
├──────────────────────────────────────────────────────────────────────┤
│ Toolbar + [Day | Week | Month] toggle  + Date column selector ⚙      │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   May 2026                                                           │
│   Mo  Tu  We  Th  Fr  Sa  Su                                         │
│   ──────────────────────────                                         │
│   27  28  29  30  1   2   3                                          │
│   4   5   6   7   8   9   10                                         │
│   11  12  13  14  15  16  17                                         │
│   18 [19] 20  21  22  23  24                                         │
│   ⬛Task1                                                            │
│   25  26  27  28  29  30  31                                         │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

- Items appear as colored bars on their date column
- Click → opens task panel
- Drag bar to reschedule
- Color by Status (or another column)

---

## Page 11: Notifications Page / Panel

Captured from Image 12.

When opened from bell icon, slides as **right panel**. Can also be a full page at `/notifications`.

```
┌─────────────────────────────────────┐
│ Notifications              ⚙ ⋯ ✕    │
├─────────────────────────────────────┤
│ All | Mentioned | Assigned to me    │
├─────────────────────────────────────┤
│ 🔍 Search...     [▢] Unread only    │
├─────────────────────────────────────┤
│                                     │
│ [Avatar] {Actor} {action message}   │
│ {board} > {task}                    │
│ {time ago}                          │
│ ─────                               │
│ [Avatar] ...                        │
│                                     │
└─────────────────────────────────────┘
```

Empty state: 🤚 illustration + "You rock!" message.

---

## Page 12: Inbox (`/inbox`)

Personal hub showing items assigned + mentioned in.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Inbox                                                                │
├──────────────────────────────────────────────────────────────────────┤
│ Tabs: Unread | All | Mentioned | Assigned                            │
│ Filters: [Board ▼] [Date ▼] [Person ▼]                               │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ Group: Today                                                         │
│  • [Update] Arslan mentioned you in "Site Audit"  · 2h               │
│  • [Assigned] You were assigned to "Prompt For Co Work"  · 4h        │
│ Group: This week                                                     │
│  ...                                                                 │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Page 13: My Work (`/my-work`)

All items assigned to me across all boards.

```
┌──────────────────────────────────────────────────────────────────────┐
│ My Work                                                              │
├──────────────────────────────────────────────────────────────────────┤
│ [Done view ▼]  Filter by board, date, status                         │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ ▼ Overdue (2)                                                        │
│   [Task] {Board name}  due 2d ago  [Status pill]                     │
│                                                                      │
│ ▼ Today (5)                                                          │
│   ...                                                                │
│                                                                      │
│ ▼ This week                                                          │
│ ▼ Later                                                              │
│ ▼ No date                                                            │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Page 14: AI Sidekick (right panel)

Captured from Image 5, 6 of earlier batch.

```
┌─────────────────────────────────────┐
│ ✨ AI Sidekick ▼          ✏ ▭ ✕    │
├─────────────────────────────────────┤
│                                     │
│ Hey {first_name},                   │
│ How can I help you move forward     │
│ with this board?                    │
│                                     │
│ [📋 Team Projects] (context chip)   │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ Message AI Sidekick...          │ │
│ │                                 │ │
│ │                          🎤 ↑   │ │
│ └─────────────────────────────────┘ │
│                                     │
│ Action suggestions:                 │
│  ✖ Organize items by phase...       │
│  🕐 Create a pie chart...           │
│                                     │
└─────────────────────────────────────┘
```

---

## Page 15: Build Vibe View (board-level full page)

Captured from Image 3 (last batch).

```
┌──────────────────────────────────────────────────────────────────────┐
│ Board header with Build Vibe view tab active                         │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│         Turn your words into work apps                               │
│      Let AI build the ideal view for {Board}                         │
│                                                                      │
│   ┌────────────────────────────────────────────────────────────┐    │
│   │ ┌──────────────────────────────────────────────────────┐   │    │
│   │ │ Describe what you want to build                      │   │    │
│   │ │                                                      │   │    │
│   │ │                                            🎤 [Build]│   │    │
│   │ └──────────────────────────────────────────────────────┘   │    │
│   │ 📎  ✨ AI model ▼                                          │    │
│   └────────────────────────────────────────────────────────────┘    │
│                                                                      │
│   Not sure where to start? Try these ideas:        🔄 Refresh        │
│   [Suggested prompt card] [Suggested prompt card]                    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

After generation: the prompt collapses into a sticky top section, generated UI fills the page below.

---

## Page 16: Dashboard

Captured from Image 16, 17, 18.

```
┌──────────────────────────────────────────────────────────────────────┐
│ {Dashboard Name} ⭐                              [⬆ Export] [👤Invite][⋯]│
├──────────────────────────────────────────────────────────────────────┤
│ [+ Add widget] [📋 Connect boards] [🔍 Type to filter] 💾  👤 Person 🔽 Filter ⚙│
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────────┐  ┌────────────────────────┐                      │
│  │ Numbers Widget │  │ Chart Widget           │                      │
│  │                │  │                        │                      │
│  │                │  │   [chart goes here]    │                      │
│  └────────────────┘  └────────────────────────┘                      │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ Battery Widget                                               │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

Grid layout, drag widgets to reposition, drag corners to resize.

---

## Page 17: Activity Log Panel (Board-Level)

Captured from Images 4-6.

Tabs: Activity / Last Viewed / Updates (all aggregated for the whole board).

---

## Page 18: Admin Panel (`/admin`)

```
┌──────────────────────────────────────────────────────────────────────┐
│ Admin                                                                │
├──────────────────────────────────────────────────────────────────────┤
│ Tabs: Users | Workspaces | Audit Log | Settings | API Keys           │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ TAB CONTENT                                                          │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Users tab
- Search + filter (role, status)
- Table: Name | Email | Role | Status | Last Active | Actions
- "Invite user" button → modal
- Bulk select: deactivate / change role

### Workspaces tab
- List workspaces
- Create / rename / delete
- Manage members

### Audit Log tab
- Full account-level history
- Filter by user, action type, date range
- Export to CSV

### Settings tab
- Account name, logo, primary color, timezone
- Default theme
- Default item height

### API Keys tab
- Gemini API key input (encrypted)
- "Test connection" button
- Usage stats (calls, tokens)

---

## Page 19: User Profile (`/profile`)

```
┌──────────────────────────────────────────────────────────────────────┐
│ [Avatar - big]  {Full Name}                                          │
│                 {Title}                              [Edit profile]  │
├──────────────────────────────────────────────────────────────────────┤
│ Tabs: About | Notifications | Theme | Security                       │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ TAB CONTENT                                                          │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Page 20: Search Overlay (Ctrl+K)

Full-screen overlay.

```
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│      🔍 Search for anything...                                       │
│      ─────────────────────────────────────────────                   │
│                                                                      │
│      Filter by: All | Items | Boards | Updates | Files | Users       │
│                                                                      │
│      Recent searches                                                 │
│      ─────                                                           │
│      [Result 1]                                                      │
│      [Result 2]                                                      │
│      ...                                                             │
│                                                                      │
│      ESC to close                                                    │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Component Library Inventory

The same components are reused across pages:

### People Picker Dropdown (NEW)
Based on Monday's standard pattern.

```
┌─────────────────────────────────┐
│ 🔍 Search people...             │
├─────────────────────────────────┤
│ [Avatar] Arslan          ✓ ✕    │  ← currently selected, click ✕ to remove
│ [Avatar] Aryan                  │
│ [Avatar] Sarah                  │
│ ───────────────                 │
│ Teams                           │
│ [Icon] Marketing Team           │
│ [Icon] Engineering              │
│ ───────────────                 │
│ + Invite a new member           │
└─────────────────────────────────┘
```

- Click cell → dropdown opens (popover style, below cell)
- Search at top filters users by name/email
- Selected users show with ✓ checkmark
- Multi-select toggle (configurable per column)
- Avatars + names listed
- Teams section below (V2 — teams feature)
- "Invite new member" link at bottom → opens invite modal
- Click outside → dropdown closes, value saves
- ESC → close without changes

### Subitems Inline Expanded (NEW)
When ▶ arrow clicked on a task row.

```
▼ Read This Instruction -2    [main row data...]
  ┌─────────────────────────────────────────────────┐
  │  (indented subitems table)                       │
  │  ☐ ⋮  Subitem A    Task 11-A   [Done]    [Date]  │
  │  ☐ ⋮  Subitem B    Task 11-B   [Working] [Date]  │
  │  ☐ ⋮  Subitem C    Task 11-C   [Not St.] [Date]  │
  │       + Add subitem                              │
  └─────────────────────────────────────────────────┘
```

- Subitem rows are indented (~40px from left)
- Same column types as parent (configurable subset)
- Drag handle on left for reordering
- Checkbox for selection
- Subtle background tint to differentiate from main rows
- "+ Add subitem" inline at bottom
- Click ▼ again → collapses
- Each subitem has its own click → opens its task panel

### Pills (colored labels)
- Status pill (configurable color)
- Person pill (avatar + name)
- Date pill
- Priority pill
- Used in: table cells, kanban cards, fields zone

### Buttons
- Primary (blue, "Create", "Save", "Invite")
- Secondary (white with grey border)
- Ghost (text only)
- Icon button (square, just icon)
- Toolbar button (icon + label)

### Dropdowns
- Standard (label + chevron, opens list)
- Picker (with avatars / icons)
- Search-enabled (with input at top)

### Modals
- Centered, max-width 600px usually
- Backdrop overlay
- ✕ close, title, body, action buttons row at bottom

### Slide-in panels
- Right-side, 50%+ width
- Used for: task detail, AI Sidekick, notifications, activity log

### Toasts
- Top-right corner
- Success (green), error (red), info (blue)
- Auto-dismiss in 4s, hover to persist

### Empty states
- Centered illustration + headline + subtext + optional CTA
- Specific per page

### Tooltips
- Hover-triggered
- Dark bg, white text, small
- Appear below or above based on viewport

### Avatars
- Circle with image or initials
- Sizes: xs, sm, md, lg, xl
- Stack with overlap when showing multiple

### Loaders
- Skeleton rows for table data
- Spinner for buttons during async
- Progress bar for uploads

---

## Visual / Density Notes

- **Default item height:** comfortable (matches Monday default)
- **Toggleable:** compact / comfortable / spacious
- **Table row min height:** ~42px comfortable, ~32px compact
- **Padding generous** — Monday is visually airy, not data-dense

---

## Responsive Behavior

- **>1280px:** Full desktop layout, all panels visible
- **1024-1280px:** Workspace panel can be collapsed
- **768-1024px:** Icon rail collapses to hamburger, single content view
- **<768px (mobile):** Single-column, simplified table → list view, panels go full-screen
- **Mobile native apps:** V3

---

## Document Status

| Field | Value |
|---|---|
| **Version** | 0.2 |
| **Status** | Draft — 20 pages mapped, all pending screens resolved with Monday-pattern assumptions |
| **Confirmed by user** | • Exact Monday layout/colors/fonts required<br>• Logo: company name text only<br>• Full task page, subitems, people picker designed per Monday patterns |

---

> **Next doc:** `07-visual-design.md` — colors, typography, vibe.
