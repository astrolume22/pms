# 🛠 PMS — Setup Requirements & Secrets Checklist

Single reference for every credential, key, file, dashboard setting, and CLI
command you need across all six phases of PMS. Walk top-to-bottom; each item
shows what it is, where to get it, exactly where it goes, and whether it's
already done or still pending.

> **Where does what go?** Three places. (A) **`F:\Work\Astrolume\pms\.env.local`**
> — your machine only, gitignored, server-side scripts read it. (B) **Netlify
> Site → Site settings → Environment variables** — only `VITE_*` keys, baked into
> the browser bundle. (C) **The encrypted admin panel input** inside the app
> itself — admin types it once, app encrypts and writes to `account` table.

---

## 1. Supabase project credentials ✅ DONE

You created the project `ddbrsoofnntzqvbtpqyc` in May 2026 and these are all
in `.env.local` already.

| Key | What it is | Where to get | Goes in |
|---|---|---|---|
| `VITE_SUPABASE_URL` | The HTTPS URL of your Supabase project's REST API. | Supabase Dashboard → Project → **Settings → API → Project URL**. | `.env.local` **and** Netlify env vars |
| `VITE_SUPABASE_ANON_KEY` | JWT that gives the browser anonymous-tier access (RLS enforces everything else). Safe to ship to clients. | Same page → **Project API keys → anon public**. | `.env.local` **and** Netlify env vars |
| `SUPABASE_SERVICE_ROLE_KEY` | JWT that **bypasses RLS**. Used by the local seed script to create auth users. **Never ship to the browser.** | Same page → **Project API keys → service_role**. Click "Reveal" to view. | `.env.local` only |
| `DATABASE_URL` | Postgres connection string. The migration runner connects with this. Never shipped. | Supabase Dashboard → **Settings → Database → Connection string → URI**. Use the **Transaction Pooler** URL (port `6543`) so corporate networks don't block it. Replace `<DB_PASSWORD>` with your project password. | `.env.local` only |

If you ever forget the DB password: Supabase Dashboard → Settings → Database →
**Reset database password**. Then update `DATABASE_URL` in `.env.local`.

---

## 2. Master admin credentials ✅ DONE

The seed script creates a super-admin Auth user with these.

| Key | What it is | Where it goes |
|---|---|---|
| `MASTER_ADMIN_USERNAME` | The username for the super-admin. Internal email becomes `<username>@pms.internal` (never shown in UI). Default: `admin`. | `.env.local` only |
| `MASTER_ADMIN_PASSWORD` | The super-admin's initial password. Change in-app after first login via My Profile → Change password. | `.env.local` only |

The three pre-seeded project managers use the **same hard-coded password**
`project123!` from `scripts/seed.ts`. Change theirs in-app the same way.

---

## 3. Netlify environment variables ✅ DONE

In Netlify → your site → **Site settings → Environment variables**, set only
the two `VITE_*` keys. Anything not prefixed `VITE_` would be invisible to the
browser bundle anyway, so don't put service keys here.

| Key | Same value as `.env.local` | Why |
|---|---|---|
| `VITE_SUPABASE_URL` | yes | Browser needs to know which Supabase project to hit. |
| `VITE_SUPABASE_ANON_KEY` | yes | Browser needs an anon JWT to authenticate REST requests. |

**Do NOT set in Netlify:** `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`,
`MASTER_ADMIN_PASSWORD`. They are migration/seed-time only.

---

## 4. Supabase storage bucket — `task-files` ✅ DONE

The Phase 4 migration `20260520_0012_phase4_storage.sql` creates a **private**
bucket called `task-files` and four storage policies that gate read/write via
`can_access_board` / `can_edit_board`. Verify in Supabase Dashboard →
**Storage → Buckets** — `task-files` should be listed with **Public** = off.

You don't need to touch this manually unless you reset the project.

---

## 5. Gemini API key 🟡 PENDING — needed for Phase 5

**Used for:** AI Create Board, AI Create Tasks, AI Chat (Sidekick).

**Where to get it:** <https://aistudio.google.com/apikey> → Create API key →
copy the value (looks like `AIza…` ~ 39 chars). Keep this tab open until you
finish step (b) below.

### Where it goes — IMPORTANT, do not put it in code

**Not** in `.env.local`. **Not** in Netlify env vars. **Not** anywhere in
`src/`. The frontend bundle (`VITE_*`) is shipped to every browser; anyone
can extract a key planted there.

Instead, in Phase 6 the admin panel will gain an **encrypted input field**:

1. Open the app → sign in as `admin` → Admin Panel → API Keys tab.
2. Paste the `AIza…` key into the **Gemini API key** input (rendered as a
   password field — characters masked).
3. Click Save.
4. The browser calls a Supabase edge function `set_gemini_key` which runs
   `pgp_sym_encrypt(key, master_passphrase)` and writes the ciphertext to
   `public.account.gemini_api_key_encrypted`. The plaintext never lives on
   disk anywhere outside Google's servers.
5. When a board uses an AI feature, edge functions like `gemini-sidekick`
   read the ciphertext, decrypt with `pgp_sym_decrypt`, call Gemini, then
   discard.

Until Phase 6 ships the admin panel UI, leave `account.gemini_api_key_encrypted`
NULL — AI buttons will show a "Set up Gemini key in Admin → API Keys" message
and stay disabled.

### Setting the master passphrase

The `pgp_sym_encrypt` master passphrase lives in **Supabase → Project Settings
→ Edge Functions → Secrets** as `GEMINI_KEY_PASSPHRASE`. Generate it once:

```powershell
# Pick something random, 32+ chars — this is the key that protects the key.
$pw = [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 } | ForEach-Object { [byte]$_ }))
$pw   # write this down somewhere offline before pasting into Supabase
```

Paste the result into the secret named `GEMINI_KEY_PASSPHRASE`. Edge functions
read it via `Deno.env.get('GEMINI_KEY_PASSPHRASE')`. Status today: **not yet
created** — Phase 5 will document the exact secret name as it lands.

---

## 6. Phase 6 follow-ups 🟡 PENDING

When we ship Phase 6 we'll need:

| Item | Where | Status |
|---|---|---|
| Custom domain (e.g. `pms.astrolume.com`) | Netlify → Domain settings → Add custom domain. Update Supabase Auth → URL Configuration to allow this origin too. | Pending — using the default `*.netlify.app` URL until then |
| Production-only Supabase JWT secret rotation | Supabase Dashboard → Settings → API → Reset anon/service keys. Update Netlify env vars + `.env.local` immediately after rotation. | Pending — only required if a key leaks |
| Per-user password reset by admin | Admin Panel → Users → ⋯ → Reset password. Uses `supabase.auth.admin.updateUserById` server-side via an edge function. | Pending — Phase 6 |

No third-party services beyond Supabase + Gemini + Netlify are required for V1.
Email (Resend), real-time presence, and AI label-assist are all V2.

---

## 7. CLI tools you must have installed

| Tool | Why | Install |
|---|---|---|
| Node.js ≥ 20 | Run the dev server, scripts, build | <https://nodejs.org> — or whatever package manager you prefer |
| npm (bundled with Node) | Dependency install | n/a |
| Git | Push to GitHub | <https://git-scm.com> |
| Git Credential Manager | Cached GitHub auth on Windows | Bundled with Git for Windows |

Optional but recommended for fresh teammates:

- **GitHub CLI** (`gh`) — `gh repo clone astrolume22/pms` is one line.
- **Supabase CLI** (later) — `supabase gen types typescript` will regenerate
  `src/lib/database.types.ts` from the live schema when V2 lands.

---

## 8. One-time setup commands for a brand-new clone

After cloning the repo on a fresh machine:

```powershell
# 1. install deps
npm install --no-audit --no-fund

# 2. copy the env template, fill in the values from sections 1 + 2 above
copy .env.example .env.local
notepad .env.local

# 3. apply the 13 SQL migrations to your Supabase project,
#    verify all 42 FKs are physically present, and seed users
npm run db:setup

# 4. start the dev server
npm run dev
# open http://localhost:5173 → sign in as admin / <MASTER_ADMIN_PASSWORD>
```

`db:setup` is the single chained command that runs:

| Script | What it does |
|---|---|
| `npm run migrate`     | Applies every `supabase/migrations/*.sql` in lexical order, each in its own transaction. Idempotent. |
| `npm run verify-fks`  | Checks `pg_catalog.pg_constraint` for the 42 expected foreign keys. Exits non-zero if any are missing. |
| `npm run seed`        | Creates the `account` row, the main workspace, and four Auth users (admin + pm1/pm2/pm3) with the correct usernames, passwords, and workspace memberships. Re-runs are safe — it upserts. |

If you only changed one of the SQL files and want a re-apply without reseeding:

```powershell
npm run migrate
npm run verify-fks
```

---

## 9. Per-phase reminder of what each item unlocks

| Phase | Needs |
|---|---|
| 1 — Foundation + Auth | Supabase keys, master admin credentials, run `db:setup` once |
| 2 — Boards | Nothing new — same Supabase setup |
| 3 — Tasks + Columns | Nothing new |
| 4 — Task details + Files | Storage bucket (auto-created by migration), nothing else |
| 5 — Views + AI | **Gemini API key** (paste into Admin → API Keys), `GEMINI_KEY_PASSPHRASE` in Supabase edge function secrets |
| 6 — Admin + Polish + Deploy | Custom domain (optional), Supabase Auth URL Configuration update if changing origin |

---

## 10. Quick-glance "did I forget anything?" checklist

Tick these once per environment (local + Netlify):

- [x] `.env.local` exists with all 6 keys filled in
- [x] `npm run db:setup` exits clean (3 ok migrations + 42/42 FKs + seed ok)
- [x] Can sign in as `admin` at <http://localhost:5173>
- [x] Netlify env vars: `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`
- [x] Netlify build succeeds with `npm run build`
- [x] Storage bucket `task-files` exists, **Public = off**
- [ ] Gemini API key entered in Admin → API Keys (Phase 5)
- [ ] `GEMINI_KEY_PASSPHRASE` set in Supabase Edge Function secrets (Phase 5)
- [ ] Custom domain configured (Phase 6, optional)

If every ticked box stays ticked, the project is ready to onboard a new
developer in under ten minutes.
