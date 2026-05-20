# 🎯 PMS — SIMPLIFIED MASTER PLAN (v2)

> **This replaces all earlier plans. Project scope DRAMATICALLY simplified for speed and reliability.**
> Old plans (72 prompts, 8 phases) archived. This is the working plan.

---

## 📌 SIMPLIFIED SCOPE — KEY CHANGES

| Aspect | Old (Complex) | New (Simple) |
|---|---|---|
| **Total Phases** | 8 | **6** |
| **Total Prompts** | 72 | **6** (1 master prompt per phase) |
| **Days** | 34-49 | **8-14** |
| **Users Model** | Email signup + invite tokens | **Pre-seeded only, login required** |
| **Master Admin** | Self-registered | **1 hardcoded admin in seed** |
| **Managers** | Invite via email | **3 pre-seeded: pm1, pm2, pm3** |
| **Manager Password** | Custom per user | **`project123!` (changeable later)** |
| **Public Access** | Some routes public | **NO route accessible without login** |
| **Signup Page** | Yes (with token) | **REMOVED** |
| **Forgot Password Email** | Resend integration | **Admin resets directly (no email)** |
| **Email System** | Resend for invites/notifications | **REMOVED in V1** |
| **Column Types** | 18 | **10 core types** |
| **Views** | 3 + Vibe View | **3 (Table, Kanban, Calendar)** |
| **AI Features** | 4 complex (Sidekick, Vibe, Auto-labels, Suggest) | **3 simple (Create Board, Create Tasks, Chat)** |
| **Workspaces** | Multiple | **One default workspace** |
| **Folders** | Yes | **No (flat structure)** |
| **Comment Replies** | Threaded | **Single-level only** |
| **Notifications** | Real-time + Email | **In-app only, basic** |

---

## 🏗 THE 6 PHASES

### PHASE 1: Foundation + Auth ⭐ (Current — Prompt 2)
**What:** Login system, pre-seeded users, auth guards on all routes
**Outcome:** Master admin + 3 PMs can login, no public access

### PHASE 2: Database + Boards
**What:** Supabase schema, board CRUD, workspace home
**Outcome:** Users can create/manage boards

### PHASE 3: Tasks + Columns
**What:** Groups, tasks, subitems, 10 column types, drag-drop
**Outcome:** Full table view working

### PHASE 4: Task Details + Comments + Files
**What:** Task panel, full page, updates, file uploads, activity log
**Outcome:** Complete task experience

### PHASE 5: Views + AI Integration
**What:** Kanban + Calendar views, Gemini AI for board/task creation
**Outcome:** Multiple views + AI-powered creation

### PHASE 6: Admin Panel + Polish + Deploy
**What:** Admin manages users, resets passwords, final polish
**Outcome:** **V1 SHIPS**

---

## 👥 USER ROLES (Simplified)

| Role | Count | Powers |
|---|---|---|
| **Master Admin** | 1 (hardcoded) | Everything — manage users, passwords, API key |
| **Manager** | 3 pre-seeded | Create/edit boards, tasks, use AI |
| **Viewer** | 0-many (admin adds) | Read-only access |

### Pre-Seeded Credentials (Phase 1)

```
Master Admin:
  Email: admin@pms.local
  Password: TempAdmin2026!
  Note: CHANGE IMMEDIATELY after first login

Manager 1:
  Username: pm1
  Email: pm1@pms.local
  Password: project123!

Manager 2:
  Username: pm2
  Email: pm2@pms.local
  Password: project123!

Manager 3:
  Username: pm3
  Email: pm3@pms.local
  Password: project123!
```

---

## 🔐 SECURITY MODEL

### What's Locked Down:
- ❌ NO public signup page
- ❌ NO forgot-password page (admin resets directly)
- ❌ ALL routes require authentication
- ❌ Direct URL access blocked unless logged in
- ❌ Server-side RLS enforces all permissions

### What's Open:
- ✅ `/login` page only (public)
- ✅ Everything else → redirect to /login if not authed

---

## 🎨 DESIGN (Unchanged)

- ✅ Exact Monday.com clone
- ✅ "PMS" text logo
- ✅ Monday blue `#0073EA`
- ✅ Roboto font
- ✅ Light + Dark mode
- ✅ 18 label colors palette (kept for variety)

---

## 🤖 AI FEATURES (Simplified to 3)

| Feature | What It Does | Model |
|---|---|---|
| **AI Create Board** | Admin/Manager types prompt → Gemini creates board with groups, columns, sample tasks | Gemini 2.5 Pro |
| **AI Create Tasks** | Type prompt → Gemini adds multiple tasks to current board | Gemini 2.5 Flash |
| **AI Chat (Sidekick)** | Simple Q&A about current board | Gemini 2.5 Flash |

### What's NOT in AI:
- ❌ Build Vibe View (complex HTML generation)
- ❌ Auto-assign labels
- ❌ Column type suggestions
- ❌ Destructive actions (delete/archive via AI)

---

## 📋 V1 FEATURE LIST (Locked)

### Phase 1 — Auth
- Login (email + password)
- Logout
- Auth guard on all routes
- Pre-seeded users
- Roles enforced (admin/manager/viewer)
- Theme toggle (light/dark)
- Basic profile view

### Phase 2 — Boards
- Single workspace (no multi-workspace)
- Workspace home page
- Create/rename/delete/archive board
- Board types: Main / Private
- Board info card
- Sidebar navigation
- Recently viewed boards

### Phase 3 — Tasks & Columns
- Groups (create/rename/color/drag-reorder)
- Tasks (create/edit/delete/drag)
- Subitems
- Auto task codes (Task 1, Task 11-A)
- **10 column types:**
  1. Task name (default)
  2. Text
  3. Status (with labels)
  4. People (assignee)
  5. Date
  6. Priority (with labels)
  7. Numbers
  8. Checkbox
  9. Dropdown (multi-label)
  10. Link
- Inline cell editing
- Label management
- Bulk select + actions (archive/delete)
- Drag-and-drop everywhere

### Phase 4 — Task Details
- Slide-in task panel
- Full-page task view
- Updates tab (rich text + @mentions + basic formatting)
- Files tab (upload, drag-drop, preview)
- Activity log tab (per-task history)
- Files column (full support)
- In-app notifications (basic)

### Phase 5 — Views + AI
- Table view (default)
- Kanban view (drag cards between status)
- Calendar view (items on dates)
- AI Create Board
- AI Create Tasks
- AI Chat panel
- Gemini API key save (encrypted, admin only)

### Phase 6 — Admin
- Admin panel page
- Users list (admin/managers/viewers)
- Add new manager / viewer
- Reset user password
- Deactivate / reactivate user
- Change user role
- Gemini API key management
- Own profile editing
- Change own password

---

## 🚫 EXPLICITLY OUT OF V1

- Email notifications
- Email invites
- Password reset via email
- Multiple workspaces
- Folders
- Forms
- Dashboards
- Docs
- Automations
- Gantt view, Chart view
- Build Vibe view
- Real-time presence
- File preview for complex types
- Auto-assign AI labels
- Column type AI suggestions
- Templates
- Public board sharing
- Marketplace apps
- Mobile native apps
- Webhooks / API
- Custom branding
- Audit log separate from activity log

All of these → V2 or later.

---

## 📅 TIMELINE

| Phase | Days | Cumulative |
|---|---|---|
| Phase 1 | 1-2 | 1-2 |
| Phase 2 | 1-2 | 2-4 |
| Phase 3 | 2-3 | 4-7 |
| Phase 4 | 1-2 | 5-9 |
| Phase 5 | 2-3 | 7-12 |
| Phase 6 | 1-2 | 8-14 |
| **TOTAL** | | **8-14 days** |

---

## ✅ CURRENT STATUS

- ✅ **Prompt 1 done** — Foundation shell built in Lovable (TanStack Router, design tokens, layout, components)
- ⏳ **Prompt 2 (Phase 1: Auth) — being written now**
- ⏳ Prompts 3-6 — write as we go

---

## 🎯 SUCCESS CRITERIA

V1 is "done" when:
1. ✅ Master admin can login
2. ✅ 3 managers (pm1/pm2/pm3) can login with `project123!`
3. ✅ Admin can add new managers/viewers from admin panel
4. ✅ Admin can reset any user's password
5. ✅ Anyone can create boards, groups, tasks
6. ✅ All 10 column types work
7. ✅ Task panel + full page + comments + files + activity log work
8. ✅ Kanban + Calendar views switchable
9. ✅ AI can create board from prompt
10. ✅ AI can create tasks from prompt
11. ✅ No route accessible without login
12. ✅ Light/dark mode works
13. ✅ Looks like Monday.com

---

> **End of simplified master plan. Onwards to Prompt 2.**
