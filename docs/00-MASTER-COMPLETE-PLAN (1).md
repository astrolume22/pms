# 🌟 PMS — MASTER COMPLETE PLAN
## (Project Management System — Internal Tool)

> **THE single document with EVERYTHING about this project.**
> Read this if you want to understand the whole project end-to-end.
> All other 9 docs are deep-dives on specific topics — this is the overview.

---

## 📑 TABLE OF CONTENTS

1. [What We're Building](#1-what-were-building)
2. [Why We're Building It](#2-why-were-building-it)
3. [Tech Stack (Locked)](#3-tech-stack-locked)
4. [The Users (Who Uses This)](#4-the-users-who-uses-this)
5. [User Roles & Permissions](#5-user-roles--permissions)
6. [Complete Functions List (200+)](#6-complete-functions-list-200)
7. [All Pages & Their Flows](#7-all-pages--their-flows)
8. [Database Schema Overview](#8-database-schema-overview)
9. [AI Features (Gemini)](#9-ai-features-gemini)
10. [Visual Design Direction](#10-visual-design-direction)
11. [Invite Flow (Detailed)](#11-invite-flow-detailed)
12. [What's in V1 vs V2 vs V3](#12-whats-in-v1-vs-v2-vs-v3)
13. [The Build Plan (77 Prompts)](#13-the-build-plan-77-prompts)
14. [Timeline & Effort](#14-timeline--effort)
15. [Current Status](#15-current-status)
16. [User Journey Examples](#16-user-journey-examples)
17. [Decisions Locked](#17-decisions-locked)
18. [Open Items](#18-open-items)

---

# 1. WHAT WE'RE BUILDING

## Project Name
**PMS** (Project Management System)

## One-Line Description
A custom-built, internal project management system for our company — modeled after Monday.com — with all premium features unlocked and AI features powered by Gemini.

## Scope
- ✅ Internal tool for our 20+ employees
- ✅ Replaces Notion + Monday.com
- ✅ Fully owned, fully customizable
- ❌ NOT a SaaS product (no external customers)
- ❌ NOT multi-tenant (single account, single org)
- ❌ NOT public (no signup page, invite-only)

## What Makes It Different From Monday
| Monday.com | Our PMS |
|---|---|
| Subdomains (`xyz.monday.com`) | Path-based (`/w/main/b/team-projects`) |
| Multi-tenant SaaS | Single internal account |
| Paid tiers (Pro/Enterprise/etc.) | Everything unlocked |
| Limited AI credits | Unlimited Gemini calls |
| Monday's own AI | Gemini API powered |
| 200+ integrations | Limited set (V2 onwards) |
| Monday's logo branding | "PMS" text logo only |

---

# 2. WHY WE'RE BUILDING IT

## The Pain
- **Monday.com paywalls** — important features locked behind tiers
- **AI credit limits** — can't use AI as much as we want
- **1-week activity log** — history disappears (we need forever)
- **Per-seat pricing** — gets expensive as team grows
- **Can't customize** — stuck with Monday's choices
- **Notion overlap** — two tools doing similar things

## The Goal
**ONE unified system** that:
- Replaces Notion + Monday.com completely
- Has unlimited AI (Gemini)
- Has unlimited history
- Scales without per-seat cost
- Is fully customizable
- Looks IDENTICAL to Monday (so employees adopt easily)

---

# 3. TECH STACK (LOCKED)

| Layer | Choice | Why |
|---|---|---|
| **Builder** | Lovable | AI-powered, fast iteration |
| **Frontend** | React + TypeScript | Industry standard |
| **Styling** | Tailwind CSS | Fast, design-system friendly |
| **Components** | shadcn/ui | Beautiful, customizable |
| **Routing** | TanStack Router (file-based) | Lovable's default, type-safe, modern |
| **Server State** | TanStack Query | Best caching, optimistic updates |
| **Client State** | Zustand | Simple, no boilerplate |
| **Rich Text** | Tiptap | Best in class for updates/comments |
| **Drag & Drop** | dnd-kit | Modern, accessible |
| **Database** | Supabase (Postgres) | All-in-one BaaS |
| **Auth** | Supabase Auth | Built-in, RLS-friendly |
| **Storage** | Supabase Storage | Files, avatars |
| **Realtime** | Supabase Realtime | Live updates |
| **Edge Functions** | Supabase Edge (Deno) | Server logic, Gemini calls |
| **AI** | Gemini API (2.5 Pro + Flash) | All AI features |
| **Email** | Resend OR Supabase | For invitations |
| **Hosting** | Lovable / custom domain | Easy deploy |
| **Icons** | lucide-react | Matches Monday's style |

---

# 4. THE USERS (Who Uses This)

## Total Users
- **20+ employees** in our company
- **Internal only** — no external customers, no public signup

## 5 Types of Users

| # | Role | Count | Who |
|---|---|---|---|
| 1 | **Super Admin** | 1 | Founder (you) |
| 2 | **Admin** | 2-3 | IT lead, senior managers |
| 3 | **Member** | 15-18 | All regular employees (default) |
| 4 | **Viewer** | 0-2 | Interns, observers, bosses (read-only) |
| 5 | **Guest** | 0 in V1 | External users (V2 only) |

---

# 5. USER ROLES & PERMISSIONS

## 👑 SUPER ADMIN (You)

**Sab kuch kar sakta hai. No limits.**

Unique powers (only Super Admin):
- Cannot be demoted by anyone
- Cannot be deactivated
- Manages Gemini API key
- Database direct access (via Supabase dashboard)
- Account-level settings
- Creates / removes Admins

Plus all Admin powers.

---

## 🛡 ADMIN

### CAN
- Invite new users (email + role)
- Deactivate / reactivate users
- Change user roles
- Resend / cancel pending invites
- Force logout users
- View all users
- Create / delete workspaces
- Workspace settings
- View ANY board (including private)
- Delete any board
- Transfer board ownership
- View audit log
- View AI usage stats
- View storage usage
- Account settings (company name, branding)

### CANNOT
- Demote Super Admin
- Change Gemini API key (Super Admin only)
- Direct database access

---

## 👨‍💼 MEMBER (Default Employee)

### Boards CAN
- Create new boards
- Rename/archive/delete OWN boards
- Edit boards they're invited to
- View Main-type boards in workspace
- See private boards (only if invited)

### Boards CANNOT
- See others' private boards
- Delete others' boards

### Tasks CAN
- Create / edit / delete tasks
- Add subitems
- Drag & drop
- Bulk actions
- Change status / labels / priority
- Assign to others
- Mention in comments
- Attach files

### Tasks CANNOT
- Edit tasks on boards they don't belong to
- Delete others' comments

### Columns CAN
- Add / reorder / resize / hide / pin columns
- Add / edit / delete labels
- Set required / default values

### Views CAN
- Create views (Table / Kanban / Calendar)
- Apply filters / sorts
- Personal vs shared views

### Invite CAN
- Invite existing users to boards
- CANNOT invite new emails to system (admin only)

### AI CAN
- Use AI Sidekick on any board
- Build Vibe views
- Auto-assign labels
- AI column suggestions

### Cannot
- Access admin panel
- Invite to system
- Deactivate users
- Delete workspaces

---

## 👁 VIEWER

### CAN
- View boards (only those invited)
- View tasks, comments, activity, files
- Download files
- Search
- View notifications (if mentioned)

### CANNOT
- Create / edit / delete anything
- Comment (configurable per-board)
- Upload files

**Use case:** Bosses, clients, interns, observers.

---

## 🔵 GUEST (V2 only — skip for V1)

External users with very limited access.

---

# 6. COMPLETE FUNCTIONS LIST (200+)

## A. AUTH & USER (10)

| # | Function | Who |
|---|---|---|
| A1 | Login (email + password) | All |
| A2 | Logout | All |
| A3 | Forgot password | All |
| A4 | Reset password via email | All |
| A5 | Signup via invite token | Invited users |
| A6 | Edit own profile | All |
| A7 | Change own password | All |
| A8 | Set notification preferences | All |
| A9 | Switch theme (light/dark) | All |
| A10 | View own activity history | All |

## B. ADMIN (13)

| # | Function | Who |
|---|---|---|
| B1 | Invite new user | Admin |
| B2 | Cancel pending invite | Admin |
| B3 | Resend invite email | Admin |
| B4 | View all users | Admin |
| B5 | Change user role | Admin |
| B6 | Deactivate user | Admin |
| B7 | Reactivate user | Admin |
| B8 | View audit log | Admin |
| B9 | Manage Gemini API key | Super Admin |
| B10 | Account settings | Admin |
| B11 | View AI usage stats | Admin |
| B12 | View storage usage | Admin |
| B13 | Force logout user | Admin |

## C. WORKSPACE (13)

| # | Function | Who |
|---|---|---|
| C1 | Switch workspaces | Members |
| C2 | Create workspace | Admin/Member |
| C3 | Rename workspace | Owner/Admin |
| C4 | Delete workspace | Owner/Admin |
| C5 | View workspace home | Members |
| C6 | Invite to workspace | Owner/Admin |
| C7 | Remove from workspace | Owner/Admin |
| C8 | Workspace settings | Owner |
| C9 | View workspace activity | Members |
| C10 | Recents tab | Members |
| C11 | Content tab | Members |
| C12 | Collaborators tab | Members |
| C13 | Permissions tab | Owner |

## D. BOARD (16)

| # | Function | Who |
|---|---|---|
| D1 | Create board | Members |
| D2 | Rename board | Owner/Member |
| D3 | Delete board | Owner |
| D4 | Archive board | Owner |
| D5 | Restore board | Owner/Admin |
| D6 | Change board type | Owner |
| D7 | Set description | Owner/Member |
| D8 | Set icon/color | Owner/Member |
| D9 | View board info card | Subscribers |
| D10 | Favorite board | Subscribers |
| D11 | Invite to board | Owner/Member |
| D12 | Remove from board | Owner |
| D13 | Transfer ownership | Owner |
| D14 | View activity log | Members |
| D15 | View "Last Viewed" | Owner/Member |
| D16 | Subscribe notifications | Members |

## E. GROUP (8)

| # | Function | Who |
|---|---|---|
| E1 | Create group | Owner/Member |
| E2 | Rename group | Owner/Member |
| E3 | Change group color | Owner/Member |
| E4 | Collapse/expand | All |
| E5 | Drag-reorder groups | Owner/Member |
| E6 | Delete group | Owner/Member |
| E7 | Duplicate group | Owner/Member |
| E8 | Move all items to another group | Owner/Member |

## F. ITEM (TASK) (20)

| # | Function | Who |
|---|---|---|
| F1 | Inline +Add task | Owner/Member |
| F2 | Toolbar new task | Owner/Member |
| F3 | Rename inline | Owner/Member/Assignee |
| F4 | Auto task code | System |
| F5 | Open slide-in panel | All |
| F6 | Open full page | All |
| F7 | Delete task | Owner/Member |
| F8 | Archive task | Owner/Member |
| F9 | Duplicate task | Owner/Member |
| F10 | Move to another group | Owner/Member |
| F11 | Move to another board (V2) | Owner/Member |
| F12 | Drag within group | Owner/Member |
| F13 | Drag between groups | Owner/Member |
| F14 | Bulk select | All |
| F15 | Bulk actions | Owner/Member |
| F16 | Star/favorite | All |
| F17 | Subscribe | All |
| F18 | Assign owner | Owner/Member |
| F19 | Convert to subitem (V2) | Owner/Member |
| F20 | View creation info | All |

## G. SUBITEMS (7)

| # | Function | Who |
|---|---|---|
| G1 | Expand inline (▶) | All |
| G2 | Add subitem | Owner/Member |
| G3 | Edit subitem | Owner/Member |
| G4 | Delete subitem | Owner/Member |
| G5 | Reorder subitems | Owner/Member |
| G6 | Auto code (Task 11-A) | System |
| G7 | Open as full task | All |

## H. COLUMNS (12)

| # | Function | Who |
|---|---|---|
| H1 | Add new column | Owner/Member |
| H2 | Choose column type | Owner/Member |
| H3 | Rename column | Owner/Member |
| H4 | Resize | All |
| H5 | Reorder | Owner/Member |
| H6 | Hide/show | All (per view) |
| H7 | Pin left/right | Owner/Member |
| H8 | Delete | Owner/Member |
| H9 | Set required | Owner/Member |
| H10 | Set default | Owner/Member |
| H11 | Inline edit cell | Owner/Member/Assignee |
| H12 | AI suggest column | Owner/Member |

### 18 Column Types in V1
Task, Text, Long text, Numbers, Status, Dropdown, Priority, People, Date, Timeline, Files, Checkbox, Link, Email, Phone, Auto Number, Creation Log, Last Updated

## I. LABELS (10)

| # | Function | Who |
|---|---|---|
| I1 | Open label picker | Owner/Member |
| I2 | Select label | Owner/Member/Assignee |
| I3 | Edit Labels modal | Owner/Member |
| I4 | Add new label | Owner/Member |
| I5 | Rename label | Owner/Member |
| I6 | Change color | Owner/Member |
| I7 | Delete label | Owner/Member |
| I8 | Drag-reorder | Owner/Member |
| I9 | Set default | Owner/Member |
| I10 | **AI auto-assign labels** | Owner/Member |

## J. VIEWS (8)

| # | Function | Who |
|---|---|---|
| J1 | Switch views (tabs) | All |
| J2 | Create new view | Owner/Member |
| J3 | Choose view type | Owner/Member |
| J4 | Rename view | Creator/Owner |
| J5 | Delete view | Creator/Owner |
| J6 | Set default view | Owner |
| J7 | Personal vs shared | Creator |
| J8 | **Build Vibe view (AI)** | Owner/Member |

## K. TOOLBAR (10)

| # | Function | Who |
|---|---|---|
| K1 | Search this board | All |
| K2 | Quick Person filter | All |
| K3 | Filter builder | All |
| K4 | Sort | All |
| K5 | Hide columns | All (per view) |
| K6 | Group by | All |
| K7 | Save to view | Owner/Member |
| K8 | Item height | All (per view) |
| K9 | Conditional coloring | Owner/Member |
| K10 | Default item values | Owner/Member |

## L. KANBAN (6)

| # | Function | Who |
|---|---|---|
| L1 | Drag card between columns | Owner/Member |
| L2 | Add task in column | Owner/Member |
| L3 | Customize card columns | Owner/Member |
| L4 | Show/hide column name | Owner/Member |
| L5 | Display cover image | Owner/Member |
| L6 | Task vs Subtask config | Owner/Member |

## M. CALENDAR (4)

| # | Function | Who |
|---|---|---|
| M1 | Switch month/week/day | All |
| M2 | Drag to new date | Owner/Member |
| M3 | Click date to add task | Owner/Member |
| M4 | Color by status | All |

## N. UPDATES / COMMENTS (13)

| # | Function | Who |
|---|---|---|
| N1 | Post new update | Members |
| N2 | @mention users | Members |
| N3 | Format text | Members |
| N4 | Insert link | Members |
| N5 | Attach file | Members |
| N6 | Insert GIF | Members |
| N7 | Insert emoji | Members |
| N8 | Reply threaded | Members |
| N9 | Like update | All |
| N10 | View count | System |
| N11 | Edit own update | Author |
| N12 | Delete own/all | Author/Owner |
| N13 | Update via email | Members |

## O. FILES (9)

| # | Function | Who |
|---|---|---|
| O1 | Upload from computer | Owner/Member |
| O2 | Drag-drop upload | Owner/Member |
| O3 | Add from URL | Owner/Member |
| O4 | Preview file | All |
| O5 | Download | All |
| O6 | Delete | Uploader/Owner |
| O7 | Search files | All |
| O8 | Grid view | All |
| O9 | List view | All |

## P. ACTIVITY LOG (8)

| # | Function | Who |
|---|---|---|
| P1 | Per-task log | Members |
| P2 | Board Activity tab | Members |
| P3 | Last Viewed tab | Members |
| P4 | Updates feed tab | Members |
| P5 | Filter by person | Members |
| P6 | Filter by action | Members |
| P7 | Undo change | Owner/Member |
| P8 | Export log | Owner/Admin |

## Q. NOTIFICATIONS (10)

| # | Function | Who |
|---|---|---|
| Q1 | View panel | All |
| Q2 | Filter (All/Mention/Assigned) | All |
| Q3 | Search | All |
| Q4 | Unread toggle | All |
| Q5 | Mark as read | All |
| Q6 | Mark all read | All |
| Q7 | Real-time push | System |
| Q8 | Email notification | System |
| Q9 | Subscribe per board | All |
| Q10 | Preferences | All |

## R. SEARCH (5)

| # | Function | Who |
|---|---|---|
| R1 | Global Ctrl+K | All |
| R2 | Category filters | All |
| R3 | Recent searches | All |
| R4 | Click → navigate | All |
| R5 | Per-board search | All |

## S. AI / GEMINI (7)

| # | Function | Who |
|---|---|---|
| S1 | AI Sidekick chat | Members |
| S2 | Suggested actions | Members |
| S3 | AI takes actions (with confirm) | Members |
| S4 | Build Vibe view | Owner/Member |
| S5 | Auto-assign labels | Owner/Member |
| S6 | Column suggestion | Owner/Member |
| S7 | AI usage stats | Admin |

## T. INBOX & MY WORK (6)

| # | Function | Who |
|---|---|---|
| T1 | Inbox page | All |
| T2 | Filter by board | All |
| T3 | Filter by date | All |
| T4 | My Work page | All |
| T5 | Group by due date | All |
| T6 | Filter by board/status | All |

## U. ARCHIVE & TRASH (5)

| # | Function | Who |
|---|---|---|
| U1 | Archive items/boards | Owner/Member |
| U2 | View archive | Owner/Admin |
| U3 | Restore | Owner/Admin |
| U4 | Delete forever | Owner/Admin |
| U5 | View trash | Owner/Admin |

### TOTAL: ~200 functions

---

# 7. ALL PAGES & THEIR FLOWS

---

## PAGE 1: LOGIN (`/login`)

### Layout
```
┌─────────────────────────────┐
│      PMS                    │
│      Welcome back           │
│                             │
│  Email: [____________]      │
│  Password: [____________]   │
│                             │
│  [✓] Remember me            │
│  Forgot password?           │
│                             │
│      [ Sign in ]            │
└─────────────────────────────┘
```

### Functions
1. Enter email + password → click "Sign in"
2. Supabase Auth validates
3. ✅ Success → goes to last-visited page
4. ❌ Wrong → "Email or password incorrect"
5. ❌ Deactivated → "Account deactivated. Contact admin."
6. Forgot password → `/forgot-password`
7. Remember me → 30-day session (default ON)

---

## PAGE 2: SIGNUP (`/signup?token=xyz`)

### Layout
```
┌─────────────────────────────┐
│   Welcome to {Company}!     │
│   You've been invited.      │
│                             │
│  Email: arsalan@xyz.com     │  ← read-only
│  Full Name: [___________]   │
│  Password: [____________]   │
│  Confirm Password: [_____]  │
│                             │
│    [ Create Account ]       │
└─────────────────────────────┘
```

### Functions
1. Page load → token verified
   - ✅ Valid → form shows
   - ❌ Expired → "Invitation expired. Ask admin."
   - ❌ Used → "Already used. Login instead."
2. User enters Name + Password
3. Click "Create Account"
4. Backend: Token marked used, Auth user created, `users` row updated
5. Auto-login → redirect to `/`

---

## PAGE 3: WORKSPACE HOME (`/` or `/w/main`)

### Layout
```
┌──────────────────────────────────────────────────────────┐
│ Top: [PMS Logo]  [Search Ctrl+K]  [🔔📥👥🧩❓⊞👤]         │
├──────────┬───────────────────────────────────────────────┤
│ Icon Rail│ Workspace Panel  │ Content Area               │
│          │                  │                            │
│ Workspace│ Main workspace ▼ │ Workspace Home             │
│ Agents   │ +                │                            │
│ Vibe     │ 📁 Workspace home│ Tabs:                      │
│ Notetaker│ 📋 Team Projects │ Recents | Content |        │
│ Favorites│ 📊 New D         │ Collaborators | Permissions│
│ More     │                  │                            │
│          │                  │ Recently viewed:           │
│          │                  │ • Team Projects (2h ago)   │
│          │                  │ • New D (yesterday)        │
└──────────┴──────────────────┴────────────────────────────┘
```

### Functions (40+)

**Top Bar:**
1. PMS Logo → click → home
2. Search bar (Ctrl+K) → opens global search
3. 🔔 Bell → notification panel
4. 📥 Inbox → inbox page
5. 👥 Invite → invite modal
6. 🧩 Apps → apps menu (V2)
7. ❓ Help → help menu
8. ⊞ Grid → all-apps grid (V2)
9. 👤 Avatar → profile menu

**Icon Rail:**
10. Workspace → workspace home
11. Agents → AI Agents (V2)
12. Vibe → Vibe library (V2)
13. Notetaker → meeting notes (V2)
14. Favorites → favorited items
15. More → other items

**Workspace Panel:**
16. Workspace switcher → switch workspaces
17. + button → Add new (Board / Doc / Dashboard / Folder)
18. Workspace home link
19. Board list → click → opens board

**Content Tabs:**
20. Recents → recently viewed
21. Content → all assets table
22. Collaborators → members + AI agents
23. Permissions → workspace privacy

---

## PAGE 4: BOARD (`/w/main/b/team-projects`)

### Layout
```
┌──────────────────────────────────────────────────────────┐
│ Top bar (same as everywhere)                             │
├──────────┬────────────────┬─────────────────────────────┤
│ Icon Rail│ Workspace Panel│ BOARD CONTENT               │
│          │                │                             │
│          │                │ Team Projects ▼  AI suggest │
│          │                │ Main table | Build Vibe | + │
│          │                │ ──────────────────────────  │
│          │                │ [+New task▼] Search Filter  │
│          │                │ ──────────────────────────  │
│          │                │ ▼ Team Red Projects         │
│          │                │ ☐ ▶ Read Instr  T1  Status  │
│          │                │ ☐ ▶ Prompt      T2  Status  │
│          │                │ + Add task                  │
│          │                │                             │
│          │                │ ▶ Task for Axel (12)        │
│          │                │ ▶ Completed (9)             │
│          │                │ + Add new group             │
└──────────┴────────────────┴─────────────────────────────┘
```

### Functions (54+)

**Board Header (10):**
1. Board name → click → info card (rename, description, type, owner)
2. ▼ chevron → board info dropdown
3. AI suggestions → AI panel
4. Integrate → V2
5. Automate → V2
6. 💬 chat → AI Sidekick
7. Avatar group → see members
8. Invite/N button → invite modal
9. 🔗 → copy URL
10. ⋯ menu → settings (archive, delete, permissions, view log)

**Tabs Row (5):**
11. Main table tab
12. Build Vibe view tab
13. Other view tabs
14. ⋯ on tab → rename/duplicate/delete
15. + → add new view

**Toolbar (8):**
16. New task ▼ → create task
17. 🔍 Search this board
18. 👤 Person quick filter
19. 🔽 Filter builder
20. ↕ Sort
21. 👁 Hide columns
22. 📁 Group by
23. ⋯ More (pin, height, coloring)

**Groups (5):**
24. ▶/▼ collapse
25. Group name → rename
26. Color bar → change color
27. Task count
28. + Add new group

**Each Task Row (8):**
29. Drag handle → reorder
30. Checkbox → bulk select
31. ▶ → expand subitems
32. Task name → opens panel
33. ⤢ → full page
34. Each cell → inline edit
35. 💬 comments icon
36. 📋 subitems icon

**Column Operations (4):**
37. Drag header → reorder
38. Drag edge → resize
39. Click header → sort
40. Header ⋯ → rename/hide/pin/delete

**+ Add Task Row:**
41. Click → create new task inline

**Column Footer Summaries (3):**
42. Status distribution bar
43. Number sums
44. People avatars

**Bulk Action Bar (when selected) (8):**
45. Duplicate
46. Export
47. Archive
48. Delete
49. Move to
50. Convert
51. AI Sidekick
52. Apps

---

## PAGE 5: BOARD + TASK PANEL (`/w/main/b/team-projects/p/123`)

Click task → right panel opens.

### Layout
```
┌─────────────────────┬──────────────────────────────────┐
│ Board (compressed)  │ ✕ Read This Instruction -2  ⋯    │
│                     ├──────────────────────────────────┤
│ ▼ Team Red Projects │ Updates/1 | Files | Activity | + │
│ ☐ Read Instr (◉)    ├──────────────────────────────────┤
│ ☐ Prompt For Co     │ [Rich text editor]               │
│ ☐ Your Personal     │                                  │
│                     │ ━━━━━━━━━━━━━━━━━━━━━━━━━━     │
│                     │                                  │
│                     │ Clairvoyant · Apr 24             │
│                     │ You will use anydesk.com and...  │
│                     │ 👍 0 · 💬 Reply · 👁 12 views    │
└─────────────────────┴──────────────────────────────────┘
```

### Functions (30+)

**Panel Header (5):**
1. ✕ close
2. Task name → edit inline
3. 👤 owner → assign/change
4. 💬 quick comment
5. ⋯ menu (duplicate, archive, delete, link, subscribe)

**Tabs (5):**
6. Updates
7. Files
8. Activity Log
9. Build Vibe view
10. + add tab

**Updates Tab — Editor (8):**
11. Bold/Italic/Underline
12. Lists, headings
13. @mention dropdown
14. Insert link
15. Attach file
16. Insert image
17. Emoji picker
18. GIF picker

**Update Actions:**
19. Update button → post
20. Dropdown: post + notify, private, schedule

**Each Comment (5):**
21. Author/avatar/date
22. Like 👍
23. Reply 💬
24. View count
25. ⋯ menu (edit, delete, copy link)

**Files Tab (6):**
26. + Add file
27. Drag-drop
28. Grid/List toggle
29. Search within
30. Click → preview
31. Delete

**Activity Tab (5):**
32. Filter log
33. Person filter
34. AI Powered toggle
35. Refresh
36. Each: avatar + action + old→new + undo

---

## PAGE 6: TASK FULL PAGE (`/w/main/b/team-projects/p/123/full`)

Hover ⤢ → standalone full page.

### Layout
```
┌──────────────────────────────────────────────────────────┐
│ ← Back  Read This Instruction -2                  ⋯      │
│ Owner: [Avatar]   ⭐ Star   🔔 Subscribe                 │
├──────────────────────────────────────────────────────────┤
│ FIELDS ZONE                                              │
│                                                          │
│ Task Code:   Task 1                                      │
│ Status:      [Working on it ▼]                           │
│ Task Type:   [Human & Co-Work ▼]                         │
│ Co-Work:     [5-10 minutes ▼]                            │
│ Priority:    [High ▼]                                    │
│ Date:        [05/19/2026 ▼]                              │
│ Person:      [Avatar1 Avatar2 +]                         │
│ Files:       📎 3 files                                  │
│ + Show more fields ▼                                     │
│                                                          │
│ ▼ Subitems (3)                                           │
│ ☐ Subitem A    [Done]    ...                             │
│ ☐ Subitem B    [Working] ...                             │
│ + Add subitem                                            │
│                                                          │
│ Tabs: Updates | Files | Activity | Vibe | +              │
│ TAB CONTENT (full-width)                                 │
└──────────────────────────────────────────────────────────┘
```

### Functions (15)
1. ← Back to board
2. Star/favorite task
3. Subscribe toggle
4-12. All fields editable (Task Code, Status, Type, Priority, Date, People, etc.)
13. + Show more fields
14. Subitems inline table (add/edit/delete)
15. Tabs same as panel but full-width

---

## PAGE 7: KANBAN VIEW

### Layout
```
┌──────────────────────────────────────────────────────────┐
│ Board header                                             │
├──────────────────────────────────────────────────────────┤
│ Toolbar                                  [⚙ ⬆ 💬]        │
├──────────────────────────────────────────────────────────┤
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│ │ DONE 15  │ │ WORKING 3│ │ STUCK 2  │ │ NOT ST   │    │
│ ├──────────┤ ├──────────┤ ├──────────┤ ├──────────┤    │
│ │ [Card]   │ │ [Card]   │ │ [Card]   │ │ [Card]   │    │
│ │ [Card]   │ │ [Card]   │ │          │ │ [Card]   │    │
│ │ + Add    │ │ + Add    │ │ + Add    │ │ + Add    │    │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘    │
└──────────────────────────────────────────────────────────┘
```

### Functions (10)
1. Drag card between columns → changes status
2. Drag within column → reorder
3. Column header ⋯ → rename, color
4. + Add task per column
5. Card click → opens panel
6. ⚙ Widget settings:
   - Customize Kanban card
   - Task vs Sub-task tabs
   - Show column name
   - Display cover image
7. Drag columns onto card preview to add fields
8. Save settings per view

---

## PAGE 8: NOTIFICATIONS PANEL

🔔 click → right slide-in.

### Layout
```
┌─────────────────────────────────┐
│ Notifications        ⚙ ⋯ ✕      │
├─────────────────────────────────┤
│ [All] [Mentioned] [Assigned]    │
├─────────────────────────────────┤
│ 🔍 Search       [▢] Unread only │
├─────────────────────────────────┤
│ [Avatar] Arslan mentioned you   │
│ in "Site Audit" · 2h ago        │
│ ─────                           │
│ [Avatar] You were assigned to   │
│ "Prompt For Co Work" · 4h ago   │
└─────────────────────────────────┘
```

### Functions (7)
1. 3 tabs filter
2. Search
3. Unread only toggle
4. Click → navigate, mark read
5. Per-item ⋯ → mark unread, dismiss
6. ⚙ settings
7. Top ⋯ → mark all read

---

## PAGE 9: INBOX (`/inbox`)

### Layout
```
┌──────────────────────────────────────────────────────────┐
│ Inbox                                                    │
├──────────────────────────────────────────────────────────┤
│ Tabs: [Unread] [All] [Mentioned] [Assigned]              │
│ Filters: Board ▼  Date ▼  Person ▼                       │
├──────────────────────────────────────────────────────────┤
│ ▼ Today                                                  │
│   💬 Arslan mentioned you in "Site Audit"  · 2h          │
│ ▼ This week                                              │
└──────────────────────────────────────────────────────────┘
```

### Functions (4)
1. Tabs filter
2. Multiple filters
3. Group by time
4. Click → navigate

---

## PAGE 10: MY WORK (`/my-work`)

### Layout
```
┌──────────────────────────────────────────────────────────┐
│ My Work                                                  │
├──────────────────────────────────────────────────────────┤
│ Filters: Board ▼  Status ▼                               │
├──────────────────────────────────────────────────────────┤
│ ▼ Overdue (2)                                            │
│ ▼ Today (5)                                              │
│ ▼ This week                                              │
│ ▼ Later                                                  │
│ ▼ No date                                                │
└──────────────────────────────────────────────────────────┘
```

### Functions (3)
1. All my assigned items
2. Grouped by due date
3. Click → opens task

---

## PAGE 11: AI SIDEKICK PANEL

### Layout
```
┌─────────────────────────────────┐
│ ✨ AI Sidekick      ✏ ▭ ✕       │
├─────────────────────────────────┤
│ Hey Arslan,                     │
│ How can I help you?             │
│                                 │
│ [📋 Team Projects] (context)    │
│                                 │
│ Suggestions:                    │
│ ✖ Organize items by phase       │
│ 🕐 Create a status chart        │
│                                 │
│ ┌────────────────────────────┐  │
│ │ Message AI Sidekick...     │  │
│ │                      🎤 ↑  │  │
│ └────────────────────────────┘  │
└─────────────────────────────────┘
```

### Functions (5)
1. Chat with Gemini
2. Suggested actions (click to use)
3. AI takes actions (with confirm)
4. New chat button
5. Maximize / close

---

## PAGE 12: BUILD VIBE VIEW

### Layout
```
┌──────────────────────────────────────────────────────────┐
│ Turn your words into work apps                           │
│ Let AI build the ideal view for Team Projects            │
│                                                          │
│ ┌────────────────────────────────────────────────────┐   │
│ │ Describe what you want to build                    │   │
│ │                                          [Build it]│   │
│ └────────────────────────────────────────────────────┘   │
│ 📎  ✨ Gemini Pro ▼                                       │
│                                                          │
│ Suggested prompts:                                       │
│ [Card] [Card] [Card]                                     │
└──────────────────────────────────────────────────────────┘
```

### Functions (5)
1. Natural language prompt input
2. Build it → Gemini generates UI
3. Model dropdown (Pro/Flash)
4. Suggested prompts (clickable)
5. Save as named view

---

## PAGE 13: ADMIN PANEL (`/admin`)

### Layout
```
┌──────────────────────────────────────────────────────────┐
│ Admin                                                    │
├──────────────────────────────────────────────────────────┤
│ Tabs: [Users] [Workspaces] [Audit Log] [Settings] [API]  │
├──────────────────────────────────────────────────────────┤
│ USERS TAB:                                               │
│ [+ Invite user]              Search ▢ Filter ▼           │
│ ────────────────────────────────────────────             │
│ Avatar  Name      Email      Role    Status   Actions    │
│ [A]     Arslan    a@x.com    Member  Active   ⋯          │
└──────────────────────────────────────────────────────────┘
```

### Functions (14)

**Users Tab:**
1. + Invite user → modal
2. Search/Filter
3. Per-user ⋯: change role / deactivate / resend / force logout

**Workspaces Tab:**
4. + Create workspace
5. Per-workspace ⋯

**Audit Log Tab:**
6. Filters (user, action, date)
7. Export CSV

**Settings Tab:**
8. Account name
9. Logo (text for now)
10. Primary color
11. Default timezone

**API Keys Tab:**
12. Gemini API key (encrypted save)
13. Test connection
14. Usage stats

---

## PAGE 14: USER PROFILE (`/profile`)

### Functions (6)
1. Edit fields (name, title, dept, phone, tz, birthday)
2. Upload avatar
3. Notification preferences
4. Theme (Light/Dark/System)
5. Change password
6. Sign out all devices

---

## PAGE 15: SEARCH OVERLAY (Ctrl+K)

### Functions (5)
1. Live search as you type
2. Category filters
3. Recent searches per user
4. Keyboard navigation
5. Click → navigate

---

## PAGE 16: WORKSPACE COLLABORATORS TAB

### Functions
1. List of workspace members
2. AI Agents section (V2)
3. Add member
4. Remove member
5. Change role

---

## PAGE 17: WORKSPACE PERMISSIONS TAB

### Functions
1. Privacy: Open / Closed / Private
2. New board defaults
3. Member permissions
4. Sharing settings

---

## PAGE 18: BOARD ACTIVITY LOG PANEL

### Functions
1. 3 tabs: Activity / Last Viewed / Updates
2. Filter by person, action
3. Time range filter
4. Undo specific changes
5. Export

---

## PAGE 19: ARCHIVE & TRASH PAGE

### Functions
1. List archived items
2. List deleted items
3. Filter by type, date
4. Restore
5. Delete forever

---

## PAGE 20: ERROR / 404 PAGE

### Functions
1. Friendly message
2. Go back button
3. Go home button

---

# 8. DATABASE SCHEMA OVERVIEW

## Top-Down Hierarchy
```
account (1 row — our company)
  └─ users (all employees)
  └─ user_invites (pending invitations)
  └─ workspaces
       └─ workspace_members
       └─ folders
            └─ boards
                 └─ board_subscribers
                 └─ board_favorites
                 └─ groups
                      └─ items (tasks)
                           └─ parent_item_id → subitems
                           └─ item_column_values (cell data)
                           └─ item_subscribers
                           └─ item_tabs (custom tabs)
                 └─ columns
                      └─ column_labels
                 └─ views
                 └─ automations (V2)
            └─ docs (V2)
            └─ dashboards (V2)
                 └─ dashboard_widgets
                 └─ dashboard_boards
            └─ forms (V2)

Cross-cutting:
  - updates (comments)
  - update_likes
  - update_views
  - update_mentions
  - files
  - file_attachments
  - activity_log (unlimited history)
  - board_last_viewed
  - notifications
  - ai_runs (Gemini logs)
  - ai_agents (V2)
```

## Total Tables
**30+ tables** in V1.

## Key Principles
- Every table has RLS enabled
- All major resources have soft-delete (`archived_at`, `deleted_at`)
- Activity log keeps unlimited history
- Indexes on FK + frequently-queried columns
- `item_column_values` uses jsonb for flexible cell data

---

# 9. AI FEATURES (GEMINI)

## What Uses AI
1. **AI Sidekick** — chat per board
2. **Build Vibe view** — AI-generated UI from prompt
3. **Auto-assign labels** — analyzes tasks, suggests labels
4. **AI column suggest** — natural language → column type

## Models Used
| Feature | Model | Why |
|---|---|---|
| AI Sidekick | gemini-2.5-pro | Best reasoning |
| Vibe view | gemini-2.5-pro | Complex code gen |
| Auto-labels | gemini-2.5-flash | Fast classification |
| Column suggest | gemini-2.5-flash | Quick |

## Architecture
- All Gemini calls via **Supabase Edge Functions**
- API key encrypted in DB (super-admin only)
- Logged in `ai_runs` table
- Rate limit: 100 calls/hour per user
- Cost tracking per user/feature

---

# 10. VISUAL DESIGN DIRECTION

## 🔒 STRICT REQUIREMENT
**EXACT Monday.com clone.** Layout, fonts, colors, spacing, components, interactions — pixel-by-pixel as close as Lovable allows.

## Why
Employees are change-resistant. Familiarity = adoption. Don't "improve" — copy.

## Brand
- **Logo:** "PMS" text only (no image yet)
- **Brand color:** Monday blue `#0073EA`
- **Header:** Dark `#292F4C`

## Typography
- **Font:** Roboto (same as Monday)
- **Sizes:** 11px / 13px / 14px / 15px / 16px / 20px / 24px / 32px / 48px
- **Weights:** 400, 500, 600, 700

## Spacing
- **4px base grid**
- All spacing multiples of 4

## Component Style
- Pill labels (signature look — colored capsules)
- Generous whitespace
- Subtle shadows
- White cards on light grey bg
- Rounded corners (4-8px)

## Colors (18 label colors)
green, red, orange, yellow, purple, dark-purple, blue, light-blue, teal, dark-teal, pink, light-pink, lime, grey, dark-grey, brown, coral, dark-blue

## Themes
- Light mode (default)
- Dark mode (toggle)

---

# 11. INVITE FLOW (DETAILED)

## Step-by-Step

### Step 1: Admin Sends Invite
- Goes to `/admin` → Users → "Invite user" button
- Or: opens any board → "Invite" button (top-right)
- Modal:
  - Email address (required)
  - Role dropdown (Admin / Member / Viewer / Guest — default: Member)
  - Workspace assignment
  - Optional message ("Welcome!")
- Click "Send invite"

### Step 2: Backend Creates Pending User
- `users` row inserted:
  - email, role, status: `invited`
  - full_name: NULL (filled by user)
- Generate secure token (UUID, 7-day expiry)
- Stored in `user_invites` table

### Step 3: Email Sent
Subject: "You've been invited to {Company} PMS"

Body:
- Welcome message
- Who invited them, their role
- Big button: "Accept invitation"
- Link: `https://pms.ourcompany.com/signup?token={token}`

### Step 4: User Clicks Link
- Lands on `/signup?token=xyz`
- Backend verifies token
- Page shows:
  - "Welcome to {Company}!"
  - Email: pre-filled, **read-only**
  - Full Name input (required)
  - Password input (min 8 chars, 1 number)
  - Confirm Password
  - "Create Account" button

### Step 5: User Submits
- Backend validates
- Creates Supabase Auth user
- Updates `users` row (status: active, name filled)
- Marks token used
- Activates workspace memberships
- Logs activity
- Auto-login → redirect to `/`

### Step 6: User Is In!
- Sees workspace, boards
- Avatar shows initials
- Can immediately work

## Edge Cases
| Case | Behavior |
|---|---|
| Token expired (>7d) | "Invitation expired. Ask admin." |
| Already used | "Already used. Login instead." |
| Email mismatch | Email locked — can't happen |
| Existing user | "User exists" — option to add to more workspaces |
| No token signup | Rejected — "Need invitation" |

---

# 12. WHAT'S IN V1 vs V2 vs V3

## 🟢 V1 (MVP — Ship First)

### Auth & Users
- ✅ Login/signup/reset
- ✅ User profiles
- ✅ Invite users
- ✅ 4 roles enforced
- ✅ Deactivate users

### Workspaces & Boards
- ✅ Multiple workspaces
- ✅ Workspace home with 4 tabs
- ✅ Board CRUD
- ✅ Board types (Main/Shareable/Private)
- ✅ Favorites

### Items
- ✅ Tasks + subitems
- ✅ Auto task codes
- ✅ Inline editing
- ✅ Bulk select
- ✅ Drag & drop

### 18 Column Types
Task, Text, Long text, Numbers, Status, Dropdown, Priority, People, Date, Timeline, Files, Checkbox, Link, Email, Phone, Auto Number, Creation Log, Last Updated

### Labels
- ✅ Full management
- ✅ Auto-assign (AI)

### 3 Views in V1
- ✅ Table (default)
- ✅ Kanban
- ✅ Calendar

### Updates
- ✅ Rich text editor
- ✅ @mentions
- ✅ Attachments
- ✅ Replies, likes

### Files
- ✅ Upload from computer / URL
- ✅ Preview

### Activity Log
- ✅ Per-item full history
- ✅ Board-level (3 tabs)
- ✅ Unlimited (no paywall)

### Notifications
- ✅ In-app panel
- ✅ Real-time push
- ✅ Email (basic)

### AI Features (V1)
- ✅ AI Sidekick
- ✅ Build Vibe view
- ✅ Auto-assign labels
- ✅ Column suggest

### Admin
- ✅ User management
- ✅ Audit log
- ✅ Account settings
- ✅ Gemini key

### Other V1
- ✅ Inbox
- ✅ My Work
- ✅ Global search
- ✅ Light/dark theme
- ✅ Responsive

---

## 🟡 V2 (After V1 Stabilizes)

- Gantt view
- Chart view
- Form view (public forms)
- File gallery, Timeline, Workload views
- Full Dashboards with widgets
- Docs (Notion-style)
- Automations (triggers + actions)
- More column types (Formula, Time Tracking, Rating, Connect, Mirror, etc.)
- File upload from cloud (GDrive, Dropbox, Webcam)
- Email digest notifications
- Mobile push
- Templates
- Google SSO + Magic Link + 2FA
- Real-time presence
- AI Suggestions, Magic Solution
- Custom item tabs (Embed, Doc, Chart, etc.)
- Cleanup mode

---

## 🔴 V3 (Power Features)

- SAML/SSO Enterprise
- Native mobile apps
- Multi-level boards
- Public board sharing
- API + webhooks
- Marketplace apps
- AI Agents
- Granular column permissions
- Cross-workspace mirroring
- Custom domain support

---

# 13. THE BUILD PLAN (77 PROMPTS)

## Phase 1 — Foundation (12 prompts, 5-7 days)
- P1.1: Project init + design tokens ⭐ **CURRENT STEP**
- P1.2: Supabase schema — core tables
- P1.3: Items & columns schema
- P1.4: Updates, files, activity, notifications schema
- P1.5: Views, dashboards, AI schema
- P1.6: Auth UI (login/signup/reset)
- P1.7: Global layout wired
- P1.8: Workspace home — Recents tab
- P1.9: Admin seed data
- P1.10: Admin panel (users + settings)
- P1.11: Invite flow end-to-end
- P1.12: Foundation polish

## Phase 2 — Board Core (15 prompts, 7-10 days)
- P2.1: Board CRUD
- P2.2: Sidebar workspace items
- P2.3: Groups CRUD
- P2.4: Items inline add
- P2.5: Basic columns (Text/Number/Status/Date/People)
- P2.6: Label editor (with Auto-assign stub)
- P2.7: Files column
- P2.8: Remaining V1 columns
- P2.9: Column operations (reorder/resize/hide/pin)
- P2.10: Toolbar (search/sort/filter/group)
- P2.11: Row selection + bulk actions
- P2.12: Subitems
- P2.13: Column footer summaries
- P2.14: Item drag-and-drop
- P2.15: Board info + settings

## Phase 3 — Items Deep (12 prompts, 5-7 days)
- P3.1: Task slide-in panel shell
- P3.2: Task full page
- P3.3: Updates rich text editor
- P3.4: Updates feed + replies
- P3.5: Files tab
- P3.6: Activity log tab (per-item)
- P3.7: Board-level activity log
- P3.8: Notifications generation
- P3.9: Notifications panel
- P3.10: Custom task tabs
- P3.11: Item subscriptions
- P3.12: Item polish

## Phase 4 — Views (10 prompts, 4-6 days)
- P4.1: Views system foundation
- P4.2: Kanban view
- P4.3: Kanban widget settings
- P4.4: Calendar view
- P4.5: Vibe view UI shell
- P4.6: View sharing & personal
- P4.7: View persistence
- P4.8: Form view stub
- P4.9: Gantt/Chart/Dashboard placeholders
- P4.10: View polish

## Phase 5 — Collaboration (8 prompts, 3-5 days)
- P5.1: Board invite modal
- P5.2: Board permissions page
- P5.3: RLS enforcement
- P5.4: Inbox page
- P5.5: My Work page
- P5.6: Email notifications
- P5.7: Global search
- P5.8: Workspace members + permissions

## Phase 6 — AI (7 prompts, 3-5 days)
- P6.1: Gemini edge function (Sidekick)
- P6.2: AI Sidekick UI
- P6.3: Vibe view generation
- P6.4: Auto-assign labels
- P6.5: Column suggest
- P6.6: Rate limiting + monitoring
- P6.7: Sidekick takes actions

## Phase 7 — Admin & Polish (5 prompts, 2-3 days)
- P7.1: Admin panel complete
- P7.2: User profile page
- P7.3: Archive/trash system
- P7.4: Conditional coloring
- P7.5: Default item values

## Phase 8 — Final Polish (8 prompts, 3-5 days)
- P8.1: Theme + responsive
- P8.2: Keyboard shortcuts
- P8.3: Empty states
- P8.4: Loading states
- P8.5: Realtime refinement
- P8.6: Export & print
- P8.7: PWA setup
- P8.8: Final QA + deploy

---

# 14. TIMELINE & EFFORT

| Phase | Prompts | Days |
|---|---|---|
| 1. Foundation | 12 | 5-7 |
| 2. Board Core | 15 | 7-10 |
| 3. Items Deep | 12 | 5-7 |
| 4. Views | 10 | 4-6 |
| 5. Collaboration | 8 | 3-5 |
| 6. AI | 7 | 3-5 |
| 7. Admin & Polish | 5 | 2-3 |
| 8. Final Polish | 8 | 3-5 |
| **TOTAL V1** | **~77** | **32-48 days** |

That's roughly **5-7 weeks of focused work.**

---

# 15. CURRENT STATUS

## ✅ Completed
- [x] 40+ Monday.com screenshots analyzed
- [x] 9 detailed planning documents (4,575 lines)
- [x] This master document
- [x] All major decisions locked
- [x] Tech stack chosen
- [x] DB schema designed
- [x] 77-prompt build plan ready
- [x] **Phase 1, Prompt 1 written and given to user**

## ⏳ In Progress
- [ ] User running Prompt 1 in Lovable
- [ ] Waiting for result

## 📋 Next Steps
1. Verify Prompt 1 result
2. Write Phase 1, Prompt 2 (Supabase schema)
3. Continue sequence
4. Test after each prompt
5. Iterate on issues

---

# 16. USER JOURNEY EXAMPLES

## Journey 1: New Employee's First Day (Arslan)

1. ✉ Email aati hai: "You're invited to PMS"
2. 🔗 Click karta hai → `/signup?token=xyz`
3. ✍ Name + password type → Create Account
4. 🏠 Auto-login → workspace home
5. 👀 Recents tab dekhta hai → empty
6. 📋 Sidebar mein "Team Projects" board pe click
7. 🗂 Board open hota hai → groups + tasks dikhte hain
8. 👤 "Person" filter → "Arslan" select → sirf apne tasks
9. 📝 Pehla task open karta hai
10. 💬 Updates tab → boss ne mention kiya
11. ✅ @boss ko reply karta hai with file attached
12. 🔔 Bell → 2 notifications
13. 📥 Inbox check karta hai
14. 🎯 My Work pe jaata hai
15. ⚙ Profile → dark theme set karta hai
16. 🤖 AI Sidekick: "What should I work on first?"
17. ✨ Gemini priority suggestion deta hai
18. 🏁 Day's work shuru

## Journey 2: Admin Invites Someone (You)

1. Login as admin
2. Go to `/admin` → Users tab
3. Click "Invite user"
4. Enter: `newemployee@company.com`, role: Member
5. Click "Send invite"
6. Email automatically sent
7. See pending user in list
8. User receives email, clicks link
9. User signs up
10. User appears as Active in admin list

## Journey 3: Member Creates Board & Tasks

1. In sidebar, click + → Board
2. Modal: enter name "Q4 Goals", choose Main type
3. Click "Create board"
4. New empty board opens
5. Default group "Group Title" present
6. Click "+ Add task" → type "Increase revenue" → Enter
7. Click Status cell → label picker → "Working on it"
8. Click Person cell → assigns to self
9. Right-click row → "+ Add subitem" → adds sub-tasks
10. Click "+" on view tabs → Kanban → creates kanban view
11. Kanban view shows tasks grouped by status

## Journey 4: AI-Powered Workflow

1. Open a board with many uncategorized tasks
2. Click Status column → "Edit Labels"
3. Click "✨ Auto-assign labels"
4. Gemini analyzes task names + descriptions
5. Suggests label for each task
6. User reviews, edits if needed
7. Click "Apply"
8. All tasks now properly labeled

---

# 17. DECISIONS LOCKED

| # | Decision | Status |
|---|---|---|
| 1 | Tech stack: Lovable + Supabase + Gemini | ✅ Locked |
| 2 | Single tenant, no multi-org | ✅ Locked |
| 3 | Path-based routing (no subdomains) | ✅ Locked |
| 4 | All features unlocked (no paywalls) | ✅ Locked |
| 5 | 20+ internal users | ✅ Locked |
| 6 | 4 user roles: Admin/Member/Viewer/Guest | ✅ Locked |
| 7 | EXACT Monday.com visual clone | ✅ Locked |
| 8 | Logo: "PMS" text only (no image yet) | ✅ Locked |
| 9 | Brand color: Monday blue `#0073EA` | ✅ Locked |
| 10 | Roboto font | ✅ Locked |
| 11 | Light + dark mode | ✅ Locked |
| 12 | Invite flow: email → token → name+password → join | ✅ Locked |
| 13 | 18 column types in V1 | ✅ Locked |
| 14 | 3 views in V1 (Table/Kanban/Calendar) | ✅ Locked |
| 15 | Gantt/Chart/Form/Dashboard → V2 | ✅ Locked |
| 16 | Docs → V2 | ✅ Locked |
| 17 | Automations → V2 | ✅ Locked |
| 18 | AI in V1: Sidekick, Vibe view, Auto-labels, Column suggest | ✅ Locked |
| 19 | Unlimited activity log history | ✅ Locked |
| 20 | Real-time updates via Supabase | ✅ Locked |
| 21 | RLS for all permission enforcement | ✅ Locked |
| 22 | Edge functions for Gemini calls | ✅ Locked |
| 23 | Theme persistence in localStorage | ✅ Locked |
| 24 | Email service: TBD (Resend or Supabase) | ⏳ Decide later |
| 25 | Custom domain: later | ⏳ Defer |

---

# 18. OPEN ITEMS

## Things to Decide Later
1. **Email provider** — Resend vs Supabase built-in (decide before Phase 5)
2. **pgvector** — Enable now or V2 (probably V2)
3. **Custom domain** — When ready to launch
4. **Logo design** — After V1 ships
5. **Backup strategy** — Supabase paid tier needed for PITR

## Things to Watch For
- Lovable credit consumption per prompt (budget accordingly)
- Gemini API costs (monitor monthly)
- Supabase storage costs as files grow
- Performance with 1000+ tasks per board

## Risk Mitigation
- Test after every prompt
- Don't accumulate bugs
- Take backups before major schema changes
- Have rollback plan for each phase

---

# 📞 QUICK REFERENCE

| Need | Where to Look |
|---|---|
| Tech specifics | Doc 8 (Tech Architecture) |
| Database fields | Doc 3 (Data Model) |
| Permissions logic | Doc 2 (Roles) |
| Visual specs | Doc 7 (Design) |
| Page layouts | Doc 6 (Screens) |
| User flows | Doc 5 (Flows) |
| What's V1 vs V2 | Doc 4 (MVP) |
| Prompt order | Doc 9 (Sequencing) |
| Overview | This document (Doc 0) |

---

# 🎯 BOTTOM LINE

We're building **an exact-look Monday.com clone for our company**, with:
- All features unlocked
- Gemini AI for all AI work
- Single internal account
- 20+ employees
- 200+ functions
- 30+ database tables
- 20 pages
- 4 user roles
- 8 build phases
- 77 prompts
- 5-7 weeks of work

**Current step:** Prompt 1 running in Lovable. Next: verify result, then Prompt 2.

---

> **End of Master Document.**
> All planning is complete. Now we build.
