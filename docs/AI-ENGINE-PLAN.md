# 🤖 PMS — AI Build Engine Plan (3 Phases)

> Goal: AI tumhare PMS ke andar boards aur tasks bana de. Tum ek prompt
> likho ("Shopify launch board banao, 4 phases, har phase ek group,
> 3-4 tasks each") aur AI poora board structure bana de.
>
> Hosting ab Vercel pe hai (Netlify se shift ho gaya). AI engine Vercel
> Functions (api/ directory) mein banega — pichla Supabase-timeout
> problem avoid karne ke liye.

---

## 🎯 BARI TASVEER — 2 Versions, 1 Engine

### Shared Core — "Build with AI" Engine
- Ek engine jo natural-language prompt le
- Gemini AI ko bheje
- Gemini structured JSON wapas de (kaunse groups/columns/labels/tasks banane hain)
- PMS us JSON ko padh ke actual board bana de
- **Ek baar banega, dono versions use karenge**

### Version B (PEHLE — foundation)
- Board pe ✨ "Build with AI" button (admin only)
- Tum prompt paste karo → AI board bana de
- Prompts "Optimus" (tumhara alag Claude project) likhta hai
- Tum copy karke PMS ke button mein paste karte ho
- **Manual copy-paste — simple, reliable**

### Version A (BAAD mein — advanced)
- MCP connector — Optimus DIRECTLY PMS se connect ho
- Copy-paste ki zarurat nahi
- Optimus khud board bana de chat se
- Tumhare Claude Max subscription pe chalega (no extra cost)

---

## 🔑 KEY DECISIONS (already approved)

| Decision | Choice |
|---|---|
| AI Model | Gemini 2.5 Flash (fast, free-tier friendly) |
| Naya AI button vs purana Sidekick | Phase 1 mein dono saath, Phase 2 mein purana hatao |
| Safety cap | 20+ actions pe "Apply N actions?" confirm |
| Actions JSON shape | create_group, create_column, create_label, create_task, update_task_status (temp refs ek batch mein) |
| Hosting for engine | Vercel Functions (api/ directory) |
| Cost | $0 — sab free tier |

---

## 📦 PHASE 1 — Build Engine + "Build with AI" Button (Version B)

**Outcome:** Har board pe ✨ button (admin only). Admin prompt paste kare
→ engine Gemini se structured actions le → PMS board bana de.

### Claude Code Karega:
1. **Shared Gemini engine** (`api/_shared/gemini-engine.ts`) — prompt
   banaye, Gemini call kare, JSON-only output enforce kare, Zod schema
   se validate kare, `{ actions: [...] }` ya `{ error }` return kare.
2. **Version B endpoint** (`api/ai-build.ts`) — Vercel Function. Caller
   ki Supabase session verify kare, admin role check kare, phir engine
   call kare.
3. **Client-side applier** — actions JSON ko le ke existing hooks
   (useCreateGroup, useCreateColumn, useCreateLabel, useCreateItem,
   useUpdateCellValue) se ek-ek action apply kare. Temp refs forward
   thread kare (taake create_task pehle banaye gaye label ko reference
   kar sake). Fail hone pe rollback.
4. **BuildWithAiModal** — ✨ button BoardHeader mein (Invite ke paas,
   admin only). Modal mein: prompt textarea, Preview button (plan
   dikhaye — "3 groups, 12 tasks banenge"), 20+ pe soft-confirm, Apply
   button (live progress), error surfacing.
5. **Env vars read** — GEMINI_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY.
6. **Purana /admin Gemini UI + AiPanel** is phase mein chhua nahi —
   saath rahega.
7. **docs/AI-ENGINE.md** — actions JSON schema + example prompts (Optimus
   ke reference ke liye).
8. **Browser-verify** — chhota prompt test, preview, apply, board bhar
   jaye.
9. **Commit + push.**

### Tum (User) Karoge:
1. **Gemini API key lo** — aistudio.google.com/apikey (free). Copy karo.
2. **Vercel mein env var add karo** — Project Settings → Environment
   Variables → `GEMINI_API_KEY` = (key). Save. Redeploy.
3. **Confirm karo** VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY Vercel mein
   already hain (deploy ke waqt daale the).
4. Optimus/claude.ai ki koi config Phase 1 mein NAHI — yeh copy-paste
   path hai.

### Phase 1 ke baad:
```
Optimus se prompt likhwao → copy → PMS board → ✨ button → paste →
Preview → Apply → board ban gaya
```

---

## 📦 PHASE 2 — Purana AI Code Hatao (Cleanup)

**Outcome:** Naya engine hi ek raasta. Purana AiPanel + pg_net Gemini
path hata diya.

### Claude Code Karega:
1. AiPanel ke 3 modes ko naye /ai-build endpoint pe shift kare (ya AiPanel
   ko naye modal se replace kare).
2. Purana code delete: AiPanel.tsx, hooks/gemini.ts, purane gemini RPCs
   (gemini_invoke, set/clear/get key). account.gemini_api_key_encrypted
   column nullable rahe (purani rows na toote), bas use band.
3. /admin se Gemini key section hatao (naya "AI: configured at Vercel"
   status indicator).
4. Prompt logging — ai_runs table (already exists) mein log kare, /admin
   pe "Recent AI runs" dikhaye.
5. Browser-verify + commit + push.

### Tum Karoge:
- Kuch nahi (agar Phase 1 mein GEMINI_API_KEY Vercel mein daal di thi).
- Sirf key rotate karni ho to Vercel env var update karo.

---

## 📦 PHASE 3 — MCP Server (Version A)

**Outcome:** Optimus directly PMS se connect ho. Copy-paste nahi. Draft
+ build ek step mein.

### Claude Code Karega:
1. **MCP endpoint** (`api/mcp.ts`) — MCP Streamable-HTTP protocol
   implement kare (Anthropic ka 2025 cloud transport). JSON-RPC accept
   kare (tools/list, tools/call).
2. **Auth** — single shared bearer-token (env var). Galat token = 401.
3. **MCP tools expose kare:**
   - list_boards, get_board (full snapshot), list_groups
   - create_board (spec_prompt se engine call), design_board_from_spec
   - create_task, bulk_create_tasks, update_task_status
4. **Server-side applier** — same actions JSON, same engine, server pe
   apply (Optimus browser nahi chala raha).
5. Rate-limit + size cap (max 64KB, max 50 actions). Scoped JWT (service
   role key nahi).
6. **docs/MCP-CONNECTOR.md** — exact URL, bearer header, tool list.
7. Connector handshake verify (curl se tools/list) + commit + push.

### Tum Karoge:
1. **Bearer token banao** (32+ char random string). Vercel env var:
   `MCP_BEARER`. Redeploy.
2. **Service role key** Vercel env var: `SUPABASE_SERVICE_ROLE_KEY`
   (.env.local se).
3. **claude.ai → Settings → Connectors** → Add Custom Connector → URL
   paste (`https://your-app.vercel.app/api/mcp`) → Bearer token → save.
4. **Optimus project mein connector enable** karo.
5. **Test** — Optimus ko bolo "Shopify Launch board banao 4 phases..."
   → woh direct create_board call kare, paste-back nahi maange.

---

## 🚦 RECOMMENDED APPROACH

**Sirf Phase 1 pehle.** Use karke dekho. Solid lage to Phase 2 + 3.
Ek saath teeno mat shuru karo.

---

## 💰 COST

- Gemini API: free tier ✅
- Vercel Functions: free tier (generous) ✅
- Total: **$0/month**

---

## 📋 OPEN QUESTIONS (decide before each phase)

**Before Phase 1:** (already answered)
- Model: Flash ✅
- Alongside Sidekick ✅
- Soft-confirm 20+ ✅
- Actions JSON shape ✅

**Before Phase 3:**
- Bearer token auth (confirmed)
- Bind bearer to admin user_id? (recommended — future-proof)
- Read-only / dry-run mode? (optional)

---

## 🔄 WHAT IS "OPTIMUS"?

Optimus = tumhara alag Claude project jo achhe board-design prompts
likhta hai. Phase 1 mein woh PMS se connected NAHI — bas prompt likhta
hai, tum copy karke PMS mein paste karte ho. Phase 3 mein MCP ke through
woh directly connect ho jata hai.

---

> End of AI Engine plan. Phase 1 se shuru karenge.
