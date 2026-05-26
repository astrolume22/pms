# CLAUDE.md — PMS Project Rules (always follow, every session)

## Git workflow (NON-NEGOTIABLE)
- ALWAYS run `git pull origin main` FIRST, before reading or changing anything, every session. If the pull reports merge conflicts, STOP and tell the user — never force-push or overwrite.
- ALWAYS `git add` + `git commit` + `git push` to origin/main as the LAST step after finishing work and proving it. The project is worked on from two computers (the owner and Dr. John) — pushing every time is mandatory so the other computer can pull.

## Testing
- Test on localhost first (`npm run dev`) and prove logic via Node/code/DB scripts — do NOT wait for the Vercel deploy to test.
- The built-in browser/Chrome tool CANNOT reach localhost/127.0.0.1 and sometimes can't reach the live Vercel URL. If the browser tool can't reach the URL, DO NOT sleep/wait for a deploy and DO NOT keep retrying screenshots — just push and say "pushed, user will verify in browser." The user does visual/UI verification.

## Discipline
- Diagnose-first: on any bug, do a read-only diagnosis with REAL DB/log/network data and state the one-line root cause BEFORE fixing. Don't guess. Don't fix in one giant change — small, verified steps.
- DEMAND PROOF: after a fix, show the actual DB row / Node script output / network trace proving it worked.
- DATA OWNERSHIP: ON DELETE SET NULL on user foreign keys, NEVER CASCADE. Single-row updates by exact id. Never touch the `answers` table destructively.
- tsc + vite build must pass clean after changes. Don't break existing features.

## Stack (reference)
- React + Vite + TS, TanStack Router/Query, Zustand, Tailwind, shadcn, dnd-kit.
- Supabase (ref ddbrsoofnntzqvbtpqyc). Vercel hosting. GitHub astrolume22/pms. Canonical live URL: https://p-m-system.vercel.app (custom domain projects.expertintuitiveadvisor.com).
