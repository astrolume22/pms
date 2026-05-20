# 🎯 PMS — MVP vs V2 vs V3 Scope

> **Document 4 of 9** — What ships when. Ruthless prioritization.

---

## Philosophy

**Lovable failures usually come from scope creep.** Every "small extra feature" doubles the chance the build breaks.

We ship V1 with everything needed for daily team work, then iterate. V1 should make the team say *"this already replaces Monday for 80% of what we do."*

---

## 🟢 V1 — MVP (Must Ship)

The minimum viable PMS the team can use daily.

### Authentication & Users
- ✅ Email + password login
- ✅ Email verification
- ✅ Password reset
- ✅ User profiles (name, email, avatar, title, timezone)
- ✅ Invite users (admin sends email invite)
- ✅ Account roles: Admin / Member / Viewer / Guest
- ✅ Deactivate user (soft, with content preserved)

### Workspaces
- ✅ Single "Main workspace" pre-seeded
- ✅ Multiple workspaces (admin can create more)
- ✅ Workspace home page with **Recents / Content / Collaborators** tabs
- ✅ Workspace members list

### Boards
- ✅ Create / rename / archive / delete board
- ✅ Board types: Main / Shareable / Private
- ✅ Board owner + subscribers
- ✅ Board info card (description, type, owner, created info)
- ✅ Favorite boards (left sidebar)
- ✅ Board sidebar listing in workspace

### Groups
- ✅ Create / rename / color / collapse / delete groups
- ✅ Drag to reorder
- ✅ Aggregate column summaries when collapsed (status distribution bars, file counts)
- ✅ Per-group color identifier (left vertical bar)

### Items (Tasks)
- ✅ Create / edit / delete items
- ✅ Item drag-to-reorder (within group)
- ✅ Drag items between groups
- ✅ Bulk select + actions (duplicate, export, archive, delete, move to, convert)
- ✅ Item slide-in panel (Updates / Files / Activity Log / Build Vibe view tabs)
- ✅ Item full-page view (with fields zone)
- ✅ Subitems (nested under parent items)
- ✅ Auto-generated task codes (Task 1, Task 2... Task 11-A for subitems)
- ✅ Inline cell editing
- ✅ "+ Add task" inline at end of each group

### Columns (V1 set — must have)
- ✅ **Task name** (always present, primary)
- ✅ **Text** (short)
- ✅ **Long text**
- ✅ **Numbers** (with unit prefix/suffix)
- ✅ **Status** (colored labels)
- ✅ **Dropdown** (multi-label)
- ✅ **Priority** (preset label set)
- ✅ **People** (assignee, multi-select)
- ✅ **Date** (with optional time)
- ✅ **Timeline** (start + end date)
- ✅ **Files** (attachments)
- ✅ **Checkbox**
- ✅ **Link** (URL with display text)
- ✅ **Email**
- ✅ **Phone**
- ✅ **Auto Number** (auto-incrementing)
- ✅ **Creation Log** (auto, who/when created)
- ✅ **Last Updated** (auto)

### Column Operations
- ✅ Add column (+ button on right of table)
- ✅ Reorder columns (drag headers)
- ✅ Resize columns (drag handle)
- ✅ Hide/show columns (Hide button → checkbox list)
- ✅ Pin column left/right (... menu)
- ✅ Item height settings (compact / comfortable / spacious)
- ✅ Conditional coloring (rules engine — e.g., if Priority=High then row=red)
- ✅ Default item values

### Labels Management
- ✅ Edit Labels modal per status/dropdown/priority column
- ✅ Add / rename / delete labels
- ✅ Color picker (basic palette + patterns)
- ✅ Drag to reorder labels
- ✅ Set default label

### Views
- ✅ **Table view** (main, default)
- ✅ **Kanban view** (drag cards between status columns)
- ✅ **Calendar view** (date column → calendar grid)
- ✅ Multiple views per board (tabs)
- ✅ Rename / delete view
- ✅ Per-view config (visible columns, filters, sort, etc.)
- ✅ Personal views vs shared views

### Toolbar Actions
- ✅ New task (button + dropdown for "new at top")
- ✅ Search this board
- ✅ Person filter (quick filter by assignee)
- ✅ Filter (full filter builder)
- ✅ Sort
- ✅ Hide (column visibility)
- ✅ Group by

### Updates (Comments)
- ✅ Rich text editor (bold, italic, lists, links, headings)
- ✅ @mentions (with notification)
- ✅ Image / file attach in update
- ✅ GIF support
- ✅ Emoji
- ✅ Replies (threaded)
- ✅ Like updates
- ✅ View count
- ✅ Edit / delete own update
- ✅ "Update via email" (unique email per item)

### Files
- ✅ Upload from computer
- ✅ Upload via drag & drop
- ✅ From URL link
- ✅ Files tab per item
- ✅ File preview (images, PDFs)
- ✅ Download files
- ✅ Search files within item

### Activity Log
- ✅ Per-item activity log (full history)
- ✅ Board-level activity log (with 3 tabs: Activity / Last Viewed / Updates)
- ✅ Filter by action type
- ✅ Filter by person
- ✅ Undo single changes
- ✅ **NO retention limit** (unlimited history — removed Monday's paywall)

### Notifications
- ✅ In-app notification panel (bell icon)
- ✅ Tabs: All / Mentioned / Assigned to me
- ✅ Search notifications
- ✅ Unread filter toggle
- ✅ Mark as read on click
- ✅ Real-time push (via Supabase realtime)
- ✅ Per-board subscription level (Everything / Replies & mentions / Nothing)

### Search
- ✅ Global search (Ctrl+K) — items, boards, updates, files
- ✅ Per-board search

### Permissions
- ✅ Account roles enforced
- ✅ Board-level subscribers + roles
- ✅ Supabase RLS policies on all tables

### Inbox / My Work
- ✅ Inbox page — @mentions, replies, assignments to me
- ✅ My Work page — all items assigned to me, grouped by due date

### AI (Gemini-Powered V1)
- ✅ **AI Sidekick** (chatbot per board)
- ✅ **Build Vibe view** (board-level + item-level)
- ✅ **Auto-assign labels** (label editor AI)
- ✅ **AI column type suggest** (in add column search bar)

### Admin Panel
- ✅ Users list (invite, deactivate, role change)
- ✅ Audit log
- ✅ Workspace management
- ✅ Gemini API key management
- ✅ Account settings (name, logo, primary color, timezone)

### Misc Critical
- ✅ Drag & drop everywhere (items, groups, columns, cards)
- ✅ Keyboard shortcuts (Ctrl+K search, Ctrl+/ help, etc.)
- ✅ Theme: light + dark mode
- ✅ Responsive layout (works on tablet, mobile-readable)
- ✅ Archive / trash with restore

---

## 🟡 V2 — Important (Ship after V1 stabilizes)

Things the team can live without for the first 2-3 weeks but will request quickly.

### Views
- 🟡 **Gantt view** (timeline + dependencies)
- 🟡 **Chart view** (bar / pie / line / donut)
- 🟡 **Form view** (public form → creates items)
- 🟡 **File gallery view**
- 🟡 **Timeline view**
- 🟡 **Map view** (location column)
- 🟡 **Workload view** (capacity planning)

### Dashboards
- 🟡 Multi-board dashboards
- 🟡 Widget types: Chart, Numbers, Battery, Files Gallery, Calendar, Timeline
- 🟡 Connect boards modal
- 🟡 Widget filters
- 🟡 Dashboard export
- 🟡 Dashboard sharing

### Docs (Workdocs)
- 🟡 Standalone docs in workspace
- 🟡 Docs embedded in boards
- 🟡 Docs as item tabs (Doc tab on task)
- 🟡 Rich text + slash commands (/heading, /list, /board, /chart)
- 🟡 Embed board / item in doc
- 🟡 Comments on doc blocks
- 🟡 Version history

### Automations
- 🟡 Trigger-action recipes
- 🟡 Predefined recipe library (when status → move group, recurring items, deadline notify)
- 🟡 Custom automation builder
- 🟡 Conditional logic
- 🟡 Automation activity feed
- 🟡 Pause/resume automations

### Columns (V2 set)
- 🟡 **Formula** (calculated)
- 🟡 **Time Tracking** (start/stop timer)
- 🟡 **Rating** (1-5 stars)
- 🟡 **Tags**
- 🟡 **Country**
- 🟡 **Connect Boards** (link to items in other boards)
- 🟡 **Mirror** (reflect data from connected board)
- 🟡 **Dependency** (task depends on task)
- 🟡 **Progress** (% bar)
- 🟡 **Vote**
- 🟡 **Button** (triggers automation)
- 🟡 **Color Picker**

### Files (V2)
- 🟡 From Webcam capture
- 🟡 From Google Drive
- 🟡 From Dropbox / Box / OneDrive
- 🟡 Inline image preview in updates
- 🟡 PDF annotations
- 🟡 Image markup tool

### Notifications (V2)
- 🟡 Email notifications (digest + immediate)
- 🟡 Mobile push (via web push API)
- 🟡 Slack / Teams forwarding
- 🟡 Notification rules per-board

### Real-Time Collaboration
- 🟡 Live cursor on docs
- 🟡 Live editing indicators on tasks ("Arslan is editing this")
- 🟡 Real-time presence in board (who's currently viewing)

### AI (Gemini V2)
- 🟡 **AI Suggestions** (board-level recommendations)
- 🟡 **AI Search** (semantic search across everything)
- 🟡 **AI Summarize updates**
- 🟡 **AI Translate updates**
- 🟡 **AI Draft updates / replies**
- 🟡 **AI Auto-categorize items**
- 🟡 **AI Risk detection** (flag at-risk items)
- 🟡 **Magic AI solution** (generate full workspace setup from prompt)
- 🟡 **AI activity log summary**

### Integrations (V2)
- 🟡 Gmail (send/receive from items)
- 🟡 Google Calendar (sync date columns)
- 🟡 Google Drive (file picker)
- 🟡 Slack (notifications + commands)
- 🟡 Zoom (meeting links on items)

### Templates
- 🟡 Save board as template
- 🟡 Built-in template library
- 🟡 Save your own templates

### Auth (V2)
- 🟡 Google SSO
- 🟡 Magic link login
- 🟡 2FA (TOTP)
- 🟡 "Sign out from all devices"

### Misc V2
- 🟡 Custom tabs on tasks (Embed, Doc, Chart, etc.)
- 🟡 Cleanup mode (AI-powered stale-board detection)
- 🟡 Last viewed tab
- 🟡 Print board
- 🟡 Excel/CSV import
- 🟡 Excel/CSV export
- 🟡 Item type icons / custom item icons
- 🟡 Cover images on Kanban cards

---

## 🔴 V3 — Advanced / Power Features

Things only specific power users will need.

### Enterprise
- 🔴 SAML / SSO (Okta, Azure AD)
- 🔴 SCIM provisioning
- 🔴 Custom branding (logo, colors, custom domain)
- 🔴 IP whitelist
- 🔴 Audit log export
- 🔴 Compliance certificates (SOC2 etc.)

### Advanced AI
- 🔴 **AI Agents** (workspace-level autonomous agents)
- 🔴 Custom agent builder with tools
- 🔴 Agent-as-assignee
- 🔴 Multi-step AI workflows
- 🔴 AI voice input/output

### Multi-Tenancy / Sharing
- 🔴 External guests with detailed permissions
- 🔴 Public board sharing (read-only links)
- 🔴 Embed board in external sites (iframe)

### Mobile
- 🔴 Native iOS app
- 🔴 Native Android app
- 🔴 Offline mode

### Integrations (V3)
- 🔴 GitHub / GitLab / Bitbucket
- 🔴 Jira / Trello / Asana migration
- 🔴 Salesforce / HubSpot
- 🔴 Stripe (for client billing tracking)
- 🔴 Shopify / WooCommerce
- 🔴 Twilio (SMS)
- 🔴 Zapier / Make integration

### Advanced Features
- 🔴 Multi-level boards (boards within boards)
- 🔴 Cross-workspace mirroring
- 🔴 Custom AI model fine-tuning
- 🔴 API + webhook system for team developers
- 🔴 Marketplace apps (third-party widgets)
- 🔴 Granular column-level permissions
- 🔴 Item-level permissions (hide specific items from specific users)

---

## 📊 V1 Build Estimate (Rough)

| Phase | Scope | Lovable prompts estimate |
|---|---|---|
| **Phase 1: Foundation** | Auth, users, workspaces, basic board CRUD | 8-12 prompts |
| **Phase 2: Board Core** | Groups, items, columns (basic types), table view | 12-15 prompts |
| **Phase 3: Items Deep** | Item panel + full page, updates, files, activity | 10-12 prompts |
| **Phase 4: Views** | Kanban, calendar, view management | 8-10 prompts |
| **Phase 5: Collaboration** | Notifications, mentions, permissions, inbox | 6-8 prompts |
| **Phase 6: AI** | Gemini integration, Sidekick, Vibe view, auto-labels | 5-7 prompts |
| **Phase 7: Admin** | Admin panel, audit, settings | 3-5 prompts |
| **Phase 8: Polish** | Search, themes, responsive, edge cases | 5-8 prompts |
| **TOTAL** | V1 | **~60-80 prompts** |

This is realistic for a 4-8 week build window with focused work.

---

## ⚠️ Cuts Made (Explicit "No for Now")

To keep V1 lean, we explicitly cut:
- ❌ Gantt view → V2
- ❌ Forms → V2
- ❌ Dashboards → V2 (basic structure in V1, no widgets)
- ❌ Docs → V2
- ❌ Automations → V2
- ❌ Most column types (Formula, Mirror, Connect, etc.) → V2
- ❌ Email notifications → V2 (in-app only for V1)
- ❌ Webcam / cloud-file integrations → V2 (local upload + link only)
- ❌ AI Agents → V3
- ❌ Templates → V2
- ❌ Real-time presence → V2

This is OK because the team's daily workflow is **mainly: open board → manage tasks → comment → check notifications**. V1 supports all of that.

---

## 🚦 Path-Based Routing for V1

To not bog down in routing complexity, V1 uses simple paths:

```
/login
/signup
/forgot-password
/reset-password

/                                  → redirect to default workspace
/inbox                             → personal inbox
/my-work                           → my assigned items
/notifications                     → notifications page (also in panel)
/profile                           → my profile
/admin                             → admin panel (admins only)

/w/{workspace_slug}                → workspace home
/w/{workspace_slug}/b/{board_slug} → board (table view default)
/w/{workspace_slug}/b/{board_slug}/v/{view_slug}     → specific view
/w/{workspace_slug}/b/{board_slug}/p/{item_id}       → task panel open
/w/{workspace_slug}/b/{board_slug}/p/{item_id}/full  → full-page task

/w/{workspace_slug}/d/{dashboard_slug} → dashboard (V2 onwards)
```

Slugs are auto-generated from names + ID suffix for uniqueness.

---

## 22. Document Status

| Field | Value |
|---|---|
| **Version** | 0.1 |
| **Status** | Draft — locked V1 scope |
| **Open questions** | Confirm V1 column list — are 18 column types enough? |

---

> **Next doc:** `05-user-flows.md` — step-by-step user journeys.
