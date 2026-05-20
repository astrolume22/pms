# 📘 PMS — Product Definition

> **Document 1 of 9** — The foundational "why" and "what" of the project.

---

## 1. Project Name

**PMS** (Project Management System)

---

## 2. One-Line Description

A custom-built, internal project management system for our company — modeled after Monday.com — with all premium features unlocked and AI features powered by Gemini.

---

## 3. Purpose & Reasoning

We are replacing our current Notion/Monday.com setup with a **fully owned, fully unlocked, customizable internal tool** that:

- Removes all paywalls (unlimited activity log history, unlimited AI, unlimited storage)
- Replaces Monday's AI features (AI Sidekick, Build Vibe view, AI Suggestions, Auto-assign labels, etc.) with our own **Gemini API** integration
- Gives us complete control over data, UI, workflows, and roadmap
- Scales with our team without per-seat licensing costs

---

## 4. Target Users

- **Internal team only** — 20+ employees
- Single organization (no multi-tenant SaaS complexity)
- Mixed roles: admins, managers, members, viewers
- Cross-functional team handling "anything" — tasks, projects, client work, internal SOPs, meetings

---

## 5. Build Stack Decisions (Locked)

| Layer | Decision |
|---|---|
| **Frontend / Builder** | Lovable |
| **Database / Auth / Storage** | Supabase (default with Lovable) |
| **AI Provider** | Gemini API (single source — replaces all Monday AI) |
| **Hosting** | Lovable default (custom domain later) |
| **Multi-tenancy** | ❌ NO — single-tenant, single-account architecture |
| **Subdomains** | ❌ NO — path-based routing only (`/workspace/board/...`) |
| **Paywalls / Plans** | ❌ NO — every feature unlocked by default |

---

## 6. What This System Replaces

- ❌ Notion (current docs/tasks)
- ❌ Monday.com (current PM tool, paywalled, AI credits limited)
- ✅ ONE unified system, fully owned, fully unlocked

---

## 7. Reference Product

**Monday.com** — we are building an **EXACT visual clone** of Monday's core PMS surface, with these key differences:

> **🔒 DESIGN LOCK:** Visual layout, fonts, colors, components, spacing, and interactions must match Monday.com as exactly as Lovable allows. **Reason:** Our employees are already trained on Monday and resist UI changes. Visual familiarity is critical for adoption.

| Monday.com | Our PMS |
|---|---|
| Subdomain per account (`xyz.monday.com`) | Path-based on single domain |
| Multi-account SaaS billing | Single internal account |
| Tiered features (Pro, Enterprise, etc.) | All features unlocked |
| Monday AI credits/limits | Unlimited Gemini API calls |
| "See plans" CTAs everywhere | Removed |
| "Unlock feature" paywalls | Removed |
| 200+ third-party integrations | Limited set (Gmail, Drive, Slack — v2+) |
| Public marketplace apps | Not applicable |
| Templates marketplace | Optional in-app library |
| Monday "m." logo | Our company name as text (no logo image in V1) |
| **Everything else (UI/UX)** | **Same as Monday** |

---

## 8. What's NOT in Scope (V1)

- ❌ Marketing/landing pages (internal only)
- ❌ Public signup / pricing pages
- ❌ Multi-tenant org switching
- ❌ Billing / invoicing / Stripe
- ❌ Email signup flows for external users
- ❌ Mobile native apps (web-responsive is enough for v1)
- ❌ Real-time collaborative cursors (v2)
- ❌ Full marketplace of third-party apps
- ❌ Enterprise SSO/SAML (v3)

---

## 9. Success Criteria

The PMS is "done" when:

1. All 20+ team members are migrated off Notion/Monday and using PMS daily
2. Every workflow they had on Monday/Notion is supported in PMS
3. AI features (Sidekick, Vibe view, etc.) work reliably via Gemini
4. Activity log retains full history forever (no 1-week limit)
5. The team agrees: "this is faster and clearer than Monday was"

---

## 10. Why Path-Based Routing (Not Subdomains)

Monday gives each company a subdomain (`yourcompany.monday.com`) because they're a multi-tenant SaaS serving thousands of orgs. We don't need that — we are **one company, one account**.

**Our URL structure:**
```
pms.ourcompany.com/                          → Home / workspace switcher
pms.ourcompany.com/workspace/main/           → Workspace home (Main workspace)
pms.ourcompany.com/board/team-projects/      → Single board (table view default)
pms.ourcompany.com/board/team-projects/kanban → Specific view
pms.ourcompany.com/board/team-projects/pulses/123 → Task slide-in panel
pms.ourcompany.com/board/team-projects/pulses/123/full → Full task page
pms.ourcompany.com/dashboard/new-d/          → Dashboard
pms.ourcompany.com/inbox/                    → Inbox
pms.ourcompany.com/notifications/            → Notifications page
pms.ourcompany.com/profile/                  → My profile
pms.ourcompany.com/admin/                    → Admin panel (admins only)
```

Cleaner, simpler, faster to build in Lovable, no DNS/subdomain hassles.

---

## 11. Out-of-the-Box Workspace Setup (Seeded)

When the PMS goes live, the database will be seeded with:

- **1 default workspace:** "Main workspace"
- **Default admin user:** the founder (you)
- **Empty boards section** — team adds their own
- **Default label sets** — preset Status (Done / Working on it / Stuck / Not Started) and Priority (Low / Medium / High / Critical) labels
- **Default column types** registered in the system

---

## 12. Document Status

| Field | Value |
|---|---|
| **Version** | 0.2 |
| **Status** | Locked — foundation confirmed by user |
| **Last updated** | May 19, 2026 |
| **Confirmed by user** | • Exact Monday visual clone<br>• No logo image — company name text<br>• Same colors/layout/fonts/spacing as Monday |

---

> **Next doc:** `02-user-roles-and-permissions.md` — who can do what.
