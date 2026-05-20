# 👥 PMS — User Roles & Permissions

> **Document 2 of 9** — Who can do what across the system.

---

## 1. Role Hierarchy (Account-Level)

We use 4 account-level roles, modeled on Monday's structure but simplified for a single internal org:

| Role | Code | Description |
|---|---|---|
| **Admin** | `admin` | Full control — manage users, workspaces, billing settings (n/a for us), system settings |
| **Member** | `member` | Standard team member — create/edit boards, items, etc. Default for most employees |
| **Viewer** | `viewer` | Read-only — can see boards they're invited to, but can't create or edit |
| **Guest** | `guest` | External / limited access — only sees specific boards explicitly shared with them |

### Default role on invite
- New users → **Member** (admin can override at invite time)
- Founders / IT → **Admin** (manually promoted)

---

## 2. Workspace-Level Roles

Each workspace can have its own owners/members on top of account roles:

| Workspace Role | Description |
|---|---|
| **Workspace Owner** | Created the workspace, can rename, delete, manage members |
| **Workspace Member** | Has access to the workspace, can create boards inside |
| **Workspace Collaborator** | Limited — sees specific assets only |

> Note: A user can be **Account Admin** but only a **Workspace Member** in some workspaces, or vice versa. Role at the most granular level wins for that asset.

---

## 3. Board-Level Roles

Each board has its own subscribers/permissions:

| Board Role | Badge | Description |
|---|---|---|
| **Board Owner** | 👑 Crown | Created or transferred to. Can rename/delete the board, manage subscribers |
| **Board Member** | (none) | Standard — can edit items, columns, automations |
| **Board Viewer** | 👁 | Read-only access to this specific board |
| **Board Guest** | 🔵 G | External — sees only this board, nothing else |

---

## 4. Board Privacy Types

| Type | Icon | Who can see |
|---|---|---|
| **Main** | 📋 | Everyone in the workspace can see this board |
| **Shareable** | 🔗 | Workspace members + invited external guests |
| **Private** | 🔒 | Only specifically invited people |

(Captured from board info card — Image 9 of last batch.)

---

## 5. Permission Matrix — What Each Role Can Do

### Account-Level Actions

| Action | Admin | Member | Viewer | Guest |
|---|:-:|:-:|:-:|:-:|
| Invite new users | ✅ | ❌ | ❌ | ❌ |
| Deactivate users | ✅ | ❌ | ❌ | ❌ |
| Change user roles | ✅ | ❌ | ❌ | ❌ |
| Manage workspaces (create/delete) | ✅ | ⚠️ create only | ❌ | ❌ |
| View audit logs | ✅ | ❌ | ❌ | ❌ |
| Manage API keys / Gemini key | ✅ | ❌ | ❌ | ❌ |
| Access admin panel | ✅ | ❌ | ❌ | ❌ |
| Edit company branding | ✅ | ❌ | ❌ | ❌ |

### Workspace-Level Actions

| Action | WS Owner | WS Member | WS Collab |
|---|:-:|:-:|:-:|
| Rename workspace | ✅ | ❌ | ❌ |
| Delete workspace | ✅ | ❌ | ❌ |
| Invite to workspace | ✅ | ⚠️ if allowed | ❌ |
| Create boards in workspace | ✅ | ✅ | ❌ |
| View all boards in workspace | ✅ | ✅ | ⚠️ specific only |
| Manage workspace permissions | ✅ | ❌ | ❌ |

### Board-Level Actions

| Action | Board Owner | Board Member | Board Viewer | Board Guest |
|---|:-:|:-:|:-:|:-:|
| View board | ✅ | ✅ | ✅ | ✅ |
| Create items / subitems | ✅ | ✅ | ❌ | ⚠️ if allowed |
| Edit items | ✅ | ✅ | ❌ | ⚠️ if allowed |
| Delete items | ✅ | ✅ | ❌ | ❌ |
| Add / edit / delete columns | ✅ | ✅ | ❌ | ❌ |
| Add / edit / delete groups | ✅ | ✅ | ❌ | ❌ |
| Add / edit views | ✅ | ✅ | ⚠️ own only | ❌ |
| Set up automations | ✅ | ✅ | ❌ | ❌ |
| Invite to board | ✅ | ⚠️ if allowed | ❌ | ❌ |
| Rename / delete board | ✅ | ❌ | ❌ | ❌ |
| Archive board | ✅ | ❌ | ❌ | ❌ |
| Change board type (Main/Shareable/Private) | ✅ | ❌ | ❌ | ❌ |
| Post updates / comments | ✅ | ✅ | ⚠️ if allowed | ⚠️ if allowed |
| Upload files | ✅ | ✅ | ❌ | ⚠️ if allowed |
| Use AI Sidekick | ✅ | ✅ | ⚠️ read-only | ❌ |
| Use Build Vibe view | ✅ | ✅ | ❌ | ❌ |

### Item-Level (Task-Level)

| Action | Owner of task | Assignee | Member | Viewer |
|---|:-:|:-:|:-:|:-:|
| Edit task name | ✅ | ✅ | ✅ | ❌ |
| Change status / labels | ✅ | ✅ | ✅ | ❌ |
| Reassign | ✅ | ✅ | ✅ | ❌ |
| Delete task | ✅ | ❌ | ⚠️ board allows | ❌ |
| Post update | ✅ | ✅ | ✅ | ⚠️ if allowed |
| @mention | ✅ | ✅ | ✅ | ❌ |
| Subscribe / unsubscribe | ✅ | ✅ | ✅ | ✅ |

---

## 6. Granular / Column-Level Permissions (V2)

In V2, we can lock individual columns:
- "Salary" column → only visible to HR-tagged users
- "Internal notes" column → only board owners
- Column-level read/write restrictions

V1: skip — board-level is enough.

---

## 7. Special Cases

### The Founder / Super-Admin
- One designated account-level **Super-Admin** that cannot be demoted by other admins
- Cannot be deactivated
- Always has full access everywhere
- Manages the Gemini API key

### Deactivated Users
- Their content (items they created, updates they posted) stays in place
- Avatar appears greyed out / "Deactivated" label
- They can be reactivated by admin
- Their assigned tasks get a "⚠️ Reassign needed" indicator

### Guests vs Members billing
- Not applicable — no billing
- But we still track guest-vs-member for permission enforcement

---

## 8. Authentication

- Email + password (basic for v1)
- Email verification on signup
- Password reset flow
- "Magic link" login (v2)
- Google SSO (v2)
- 2FA (v2)
- SAML / Enterprise SSO (v3)

### Session
- Long-lived sessions (30 days default)
- "Remember me" by default
- Sign out from all devices option

---

## 9. Invite Flow (DETAILED — Confirmed by User)

### Full end-to-end flow:

**Step 1 — Admin sends invite**
- Admin opens admin panel `/admin` → Users tab → "Invite user" button
- OR: Board owner opens board → "Invite / N" button (top-right) → modal opens
- Modal fields:
  - Email address (required)
  - Role dropdown (Admin / Member / Viewer / Guest — default: Member)
  - Workspace assignment (which workspaces they join)
  - Optional message ("Welcome to the team!")
- Click "Send invite"

**Step 2 — Backend creates pending user**
- `users` row inserted with:
  - `email`: the invited email
  - `status`: `invited`
  - `role`: assigned role
  - `full_name`: NULL (will be filled by user on signup)
  - Other fields NULL
- Unique invite token generated (UUID, 7-day expiry)
- Token stored in a `user_invites` table:
  - `id`, `user_id`, `token`, `email`, `expires_at`, `created_by`, `used_at`
- Workspace memberships pre-created (status pending)
- Board subscribers pre-created if invited from board

**Step 3 — Email sent**
- Email sent to user with:
  - Subject: "You've been invited to {Company Name} PMS"
  - Body: Welcome message, who invited them, role they'll have
  - Big CTA button: "Accept invitation"
  - Link: `https://pms.ourcompany.com/signup?token={invite_token}`
  - Token expires in 7 days

**Step 4 — User clicks invitation link**
- Lands on `/signup?token={invite_token}`
- Backend verifies token:
  - Token exists, not expired, not already used
  - If invalid → "This invitation is invalid or expired. Contact your admin."
- Page shows:
  - "Welcome to {Company Name}!"
  - Email: pre-filled, **read-only** (can't change)
  - Full Name input (required) — user enters their name
  - Password input (required, min 8 chars, at least 1 number)
  - Confirm Password input
  - "Create Account" button

**Step 5 — User submits signup form**
- Backend validates:
  - Token still valid
  - Password meets rules
  - Name not empty
- Creates Supabase Auth user with email + password
- Updates `users` row:
  - `status`: `active`
  - `full_name`: from form
  - `id`: matches auth user ID
- Marks invite token as used (`user_invites.used_at = now()`)
- Activates workspace memberships
- Logs activity: `user_joined`
- Auto-login the user
- Redirects to `/` → workspace home

**Step 6 — User is in**
- Sees workspace, boards they were invited to
- Can immediately start working
- Their avatar shows with initials (until they upload a photo)

### Edge cases

| Case | Behavior |
|---|---|
| Token expired (>7 days) | Show "Invitation expired. Ask your admin to resend." Admin can click "Resend invite" |
| Token already used | Redirect to `/login` with message "This invitation was already used. Please log in." |
| Email mismatch attempt | Email is locked (read-only), so this can't happen via UI |
| Admin invites already-existing user | Show "User already exists" — option to add to additional workspaces/boards instead |
| User registers with same email but no token | Reject — "Signup requires an invitation. Contact your admin." |
| Admin cancels invite | Delete invite token, mark `users.status` as `cancelled` (or hard delete if never used) |

### Resend invitation
- Admin can click "Resend" on pending users in admin panel
- Generates new token, invalidates old one, sends fresh email

### Board-level invite (subset)
- Same flow but adds them only to a specific board
- If user already exists in the system → directly added (no email)
- If new email → full signup flow above + auto-added to that board on accept

---

## 10. Implementation Notes for Supabase

- Supabase **Auth** handles login/signup/reset
- Supabase **Row Level Security (RLS)** policies enforce all permissions at the DB level
- Custom `users` table extends `auth.users` with: role, status, avatar_url, full_name, title, timezone, etc.
- `workspace_members` join table for workspace-level roles
- `board_subscribers` join table for board-level roles + roles per board
- Every query through Supabase respects RLS — no permission logic in frontend alone

---

## 11. Document Status

| Field | Value |
|---|---|
| **Version** | 0.2 |
| **Status** | Updated — detailed invite flow added per user spec |
| **Confirmed by user** | Invite flow: admin invites → email → user clicks → enters name+password → joins |

---

> **Next doc:** `03-data-model.md` — every table, every field, every relationship.
