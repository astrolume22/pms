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
├── routes/                       (file-based, TanStack Router)
│   ├── __root.tsx
│   ├── _bare.tsx                (no shell — login/signup)
│   ├── _bare.login.tsx
│   ├── _bare.signup.tsx         (redirects to /login)
│   ├── _app.tsx                 (auth-gated layout)
│   ├── _app.index.tsx           (workspace home — / )
│   ├── _app.profile.tsx         (/profile)
│   └── _app.admin.tsx           (/admin — admin-only stub)
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
