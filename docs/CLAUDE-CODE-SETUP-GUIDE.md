# 🚀 PMS — Claude Code Local Setup Guide

> **Save this document.** Use it when ready to switch from Lovable to Claude Code local development.
> 
> **Strategy:** Local PC → Supabase Cloud (now) → Netlify (end)

---

## 🎯 ARCHITECTURE

```
YOUR LOCAL PC (development)
   ↓ connects to
SUPABASE CLOUD (database + auth + storage)
   ↓ later deployed to
NETLIFY (production hosting)
```

**Key:** Supabase stays same throughout. Local dev and production use SAME database.

---

## ✅ COMPLETE CHECKLIST

### STAGE 1: Software Installation

- [ ] **Node.js 20+** — nodejs.org (LTS version)
  - Verify: `node --version` → v20.x.x+
- [ ] **Git** — git-scm.com
  - Verify: `git --version`
- [ ] **VS Code** — code.visualstudio.com
- [ ] **Claude Code** — `npm install -g @anthropic-ai/claude-code`
  - Login: `claude login`
- [ ] **Windows Terminal** (Windows users) — Microsoft Store

### STAGE 2: Account Setup

- [ ] **Supabase** — supabase.com (free tier)
- [ ] **GitHub** — github.com
- [ ] **Google AI Studio** — aistudio.google.com (for Phase 5)
- [ ] **Anthropic** — already have Max plan ✅

### STAGE 3: Supabase Project Creation

- [ ] Create new project in Supabase dashboard
- [ ] Name: `pms-production`
- [ ] Set strong database password (SAVE IT!)
- [ ] Choose closest region (Mumbai/Singapore for Asia)
- [ ] Free plan
- [ ] **Save credentials:**
  - Project URL: `https://________.supabase.co`
  - Anon Key: `eyJhbG...`
  - Service Role Key: `eyJhbG...` (secret!)

### STAGE 4: Project Folder Setup

```bash
cd ~/Documents  (or wherever)
mkdir Projects
cd Projects
mkdir pms
cd pms
git init
code .  (opens VS Code)
```

### STAGE 5: Copy Planning Documents

Create `docs/` folder inside `pms/` and add:
- [ ] 00-MASTER-COMPLETE-PLAN.md
- [ ] 00-SIMPLIFIED-MASTER-PLAN-v2.md
- [ ] 01 through 09 planning docs
- [ ] PROGRESS-LOG.md
- [ ] TESTING-CHECKLIST-PHASE-1-3.md
- [ ] CLAUDE-CODE-SETUP-GUIDE.md (this document)
- [ ] Screenshots folder (40+ Monday.com images)

### STAGE 6: Create `.env.local`

Inside `pms/` folder, create file `.env.local`:

```
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here

MASTER_ADMIN_USERNAME=admin
MASTER_ADMIN_PASSWORD=YourStrongPassword2026!

VITE_GEMINI_API_KEY=add-later-in-phase-5

SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

### STAGE 7: First Claude Code Session

```bash
cd ~/Projects/pms
claude
```

Initial message to Claude Code:

```
I'm building "PMS" — a custom internal project management tool that 
clones Monday.com for our company (20 users). I'll be building this 
locally and deploying to Netlify + Supabase later.

Please read all the planning documents in the docs/ folder to 
understand the project. Start with:
1. docs/00-SIMPLIFIED-MASTER-PLAN-v2.md (current plan)
2. docs/PROGRESS-LOG.md (where we are)
3. docs/08-tech-stack-and-architecture.md (tech decisions)

After you've read these, summarize what you understand about:
- The project scope
- The tech stack
- The 6-phase plan
- What credentials I have set up

Then wait for my instructions before doing anything.
```

### STAGE 8: Phase 1 Build Instruction

After Claude Code confirms understanding:

```
Now let's start Phase 1: Foundation + Auth.

Reference docs/09-prompt-sequencing.md for the sequencing and 
docs/02-user-roles-and-permissions.md for auth design.

Build the project foundation with:
- Vite + React + TypeScript
- Tailwind CSS with design tokens from docs/07-visual-design.md
- TanStack Router (file-based routing in src/routes/)
- TanStack Query for server state
- Zustand for auth state
- shadcn/ui for components
- Supabase client using credentials in .env.local
- Monday-style layout shell (top bar with "PMS" text logo, icon 
  rail, workspace panel, content area)
- Username-only login page (NO email shown to user)
- 4 pre-seeded users: admin (from secrets), pm1/pm2/pm3 with 
  password "project123!"
- Internal email pattern: username@pms.internal
- Auth guards on all routes except /login
- NO public signup
- NO forgot-password-email flow
- NO forced password change modal
- Light + dark theme toggle with persistence

Important rules:
- NEVER show email in UI — username only
- Match Monday.com visual style exactly
- All code goes in this project folder
- Create proper Supabase migrations in supabase/migrations/
- Set up package.json with all dependencies
- Ensure all foreign keys are physically created (not just implied)
- All RLS policies must be tested before declaring complete

Start by setting up the project structure and installing dependencies.
```

### STAGE 9: Run Locally

```bash
npm run dev
# Opens at http://localhost:5173
```

### STAGE 10: Git Workflow

After each phase:
```bash
git add .
git commit -m "Phase X: Description"
```

After all complete:
```bash
git remote add origin https://github.com/USERNAME/pms.git
git push -u origin main
```

---

## 📋 PHASES PLAN

| Phase | Goal | Time |
|---|---|---|
| Phase 1 | Foundation + Auth + Pre-seeded users | 2-3 hours |
| Phase 2 | Database + Boards CRUD | 2-3 hours |
| Phase 3 | Tasks + Columns (10 types) | 3-4 hours |
| Phase 4 | Task Details + Comments + Files | 2-3 hours |
| Phase 5 | Views (Kanban + Calendar) + Gemini AI | 3-4 hours |
| Phase 6 | Admin Panel + Polish + Deploy | 2-3 hours |
| **TOTAL** | | **14-20 hours** |

---

## 🚀 FINAL DEPLOYMENT

### To Netlify:
1. Push code to GitHub
2. Netlify.com → "Import from Git"
3. Choose pms repo
4. Build command: `npm run build`
5. Publish directory: `dist`
6. Add env variables from `.env.local`
7. Deploy

### To Custom Domain:
1. Netlify → Domain settings → Add `pms.expertintuitiveadvisor.com`
2. Get CNAME from Netlify
3. Namecheap DNS → add CNAME pointing to Netlify
4. Wait 5-30 min
5. SSL auto-provisioned

---

## 🆘 TROUBLESHOOTING

| Problem | Solution |
|---|---|
| Node install fails | Restart PC, retry |
| Claude Code login fails | Verify Max plan active |
| Supabase connection error | Re-verify URL + keys in .env.local |
| `npm install` fails | Ensure Node 20+ |
| Port 5173 in use | Use different port or kill old server |
| Build error | Tell Claude Code, he'll fix |

---

## 💰 COSTS

| Service | Cost |
|---|---|
| Anthropic Max | Already have ✅ |
| Supabase Free | $0 |
| Netlify Free | $0 |
| Gemini API | $0 (within limits) |
| Namecheap domain | Already have ✅ |
| **Total** | **$0/month** |

When you grow (Year 2):
- Supabase Pro: $25/month (if needed)

---

## 📞 WHEN STUCK

1. Ask Claude Code directly (he can debug)
2. Ask me in Claude.ai chat
3. Check Supabase docs (supabase.com/docs)

---

## 🎯 DECISION CHECKLIST (Before Starting)

- [ ] Use **fresh Supabase project** (recommended) OR existing Lovable one?
- [ ] Local dev folder location decided?
- [ ] Master admin password decided?
- [ ] Have 3-5 hours uninterrupted time?
- [ ] PC has 16GB RAM and 10GB free space?

---

## 🌟 KEY DIFFERENCES FROM LOVABLE

| Aspect | Lovable | Claude Code Local |
|---|---|---|
| Where code lives | Lovable cloud | Your PC |
| How to edit | Chat prompts only | Chat OR direct file edit |
| Preview | Lovable URL | localhost:5173 |
| Database | Lovable's Supabase | Your Supabase |
| Cost | Lovable credits | Free (you have Max) |
| Control | Limited | Full |
| Speed | Faster setup | Slower setup, faster iteration |

---

## 💡 BEST PRACTICES

1. **One phase at a time** — never skip ahead
2. **Test after every change** — don't accumulate bugs
3. **Commit often** — every working feature
4. **Backup secrets** — save .env.local elsewhere too
5. **Use same Supabase** throughout dev to production
6. **Don't edit code manually** — let Claude Code handle it (initially)
7. **Read what Claude Code does** — learn the codebase gradually

---

## ✅ READY TO START?

When you have all checkboxes in Stages 1-6 done:
1. Open terminal in pms folder
2. Run `claude`
3. Paste Stage 7 initial message
4. Then paste Stage 8 Phase 1 instruction
5. Watch Claude Code build

Result after Stage 8: PMS Phase 1 working locally at localhost:5173

---

> **Document complete. Save this file for reference.**
> **Last updated: May 19, 2026**
