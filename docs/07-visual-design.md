# 🎨 PMS — Visual Design Direction

> **Document 7 of 9** — The look and feel. Colors, typography, spacing, vibe.

---

## Design Philosophy — EXACT MONDAY CLONE (Confirmed by User)

**STRICT REQUIREMENT:** Layout, fonts, colors, spacing, components — EVERYTHING matches Monday.com pixel-by-pixel as closely as Lovable allows.

### Reasoning
Internal employees are change-resistant. They are already trained on Monday's UI. Any visual deviation creates friction, slows adoption, and risks them refusing to use the new tool. Familiarity > novelty.

### What this means in practice
- ✅ Same color palette (Monday's exact hex values listed below)
- ✅ Same typography (Roboto, Monday's primary font)
- ✅ Same spacing system (4px grid, generous whitespace like Monday)
- ✅ Same component shapes (pill labels, rounded buttons, dropdown styles)
- ✅ Same layout structure (top bar, icon rail, workspace panel, content area)
- ✅ Same iconography style (Lucide icons matching Monday's vibe)
- ✅ Same interaction patterns (hover states, drag handles, slide-in panels)
- ✅ Same row heights, table styles, group color bars
- ✅ Same dark mode treatment

### What we change
- Logo: company name as text only (no logo image yet — confirmed by user)
- Brand color: keep Monday blue `#0073EA` (matches what user saw in screenshots)
- AI features visually: same UI as Monday's, just Gemini-powered behind the scenes

### Reference for build
- Every screenshot already captured = visual spec
- When in doubt → match Monday's exact pixel
- Don't "improve" the design — copy it

---

## Color Palette

### Brand / Primary
- **Primary blue** — for primary buttons, active tabs, links
  - `#0073EA` (Monday's brand blue, can customize later)
- **Primary blue hover** — `#0060BD`
- **Primary blue active** — `#004B95`

### Neutrals
| Token | Value | Usage |
|---|---|---|
| `--bg-app` | `#F6F7FB` | App background |
| `--bg-surface` | `#FFFFFF` | Cards, panels, modals |
| `--bg-hover` | `#F5F6FA` | Hover state |
| `--bg-selected` | `#E6F0FA` | Selected row (light blue) |
| `--bg-dark` | `#292F4C` | Top header bar |
| `--border-light` | `#E6E9EF` | Subtle borders |
| `--border-medium` | `#C3C6D4` | Inputs, dividers |
| `--text-primary` | `#323338` | Body text |
| `--text-secondary` | `#676879` | Labels, captions |
| `--text-disabled` | `#9699A6` | Disabled state |
| `--text-on-dark` | `#FFFFFF` | Top bar text |

### Status / Label Colors (Monday-style preset palette)
A wide range of saturated-but-soft colors that users pick for labels.

| Name | Hex | Use case examples |
|---|---|---|
| `green` | `#00C875` | Done, Success, Approved |
| `red` | `#E2445C` | Stuck, Critical, Blocked |
| `orange` | `#FDAB3D` | Working on it, In Progress |
| `yellow` | `#FFCB00` | Pending, Review |
| `purple` | `#A25DDC` | By Human, Special |
| `dark-purple` | `#784BD1` | High Priority |
| `blue` | `#0086C0` | Info, Planned |
| `light-blue` | `#579BFC` | Low Priority |
| `teal` | `#037F4C` | Done variant |
| `dark-teal` | `#0F5662` | Type indicator |
| `pink` | `#FF158A` | Special / Important |
| `light-pink` | `#FF6E92` | Variant |
| `lime` | `#9CD326` | Active |
| `grey` | `#C4C4C4` | Not Started, Default |
| `dark-grey` | `#808080` | Archived |
| `brown` | `#7E3B08` | Custom |
| `coral` | `#FF7575` | Custom warm |
| `dark-blue` | `#225091` | Deep |

> **Custom colors:** users can also pick any hex via color picker.

### Semantic Colors
| Token | Value | Usage |
|---|---|---|
| `--success` | `#00C875` | Confirmation toasts, success badges |
| `--warning` | `#FDAB3D` | Warning toasts |
| `--error` | `#E2445C` | Error states, destructive actions |
| `--info` | `#0086C0` | Info toasts |

### Group Colors (vertical bar on left of groups)
Same palette as labels — user picks per group.

---

## Typography

### Font Family
- **Primary:** `"Roboto", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`
- **Mono (code blocks, IDs):** `"Roboto Mono", "Fira Code", monospace`

### Type Scale
| Token | Size | Line Height | Weight | Usage |
|---|---|---|---|---|
| `--text-xs` | 11px | 16px | 400 | Tiny labels, badges |
| `--text-sm` | 13px | 18px | 400 | Body small, table cells |
| `--text-base` | 14px | 20px | 400 | Standard body |
| `--text-md` | 15px | 22px | 500 | Emphasized body |
| `--text-lg` | 16px | 24px | 500 | Section headings |
| `--text-xl` | 20px | 28px | 600 | Page section titles |
| `--text-2xl` | 24px | 32px | 600 | Card/panel headers |
| `--text-3xl` | 32px | 40px | 700 | Page titles, board name |
| `--text-hero` | 48px | 56px | 700 | Vibe view hero, empty states |

### Specific Usage
- **Board name:** `text-3xl` weight 700
- **Group name:** `text-lg` weight 600 colored
- **Task name:** `text-base` weight 400
- **Pill text:** `text-xs` weight 500
- **Update content:** `text-base` weight 400, line-height 24px

---

## Spacing System

Use a **4px base grid**.

| Token | Value | Usage |
|---|---|---|
| `--space-0` | 0 | |
| `--space-1` | 4px | |
| `--space-2` | 8px | Tight gaps |
| `--space-3` | 12px | Standard cell padding |
| `--space-4` | 16px | Card padding |
| `--space-5` | 20px | |
| `--space-6` | 24px | Section spacing |
| `--space-8` | 32px | Panel padding |
| `--space-10` | 40px | Large gaps |
| `--space-12` | 48px | Page section gaps |
| `--space-16` | 64px | Hero spacing |

---

## Border Radius

| Token | Value | Usage |
|---|---|---|
| `--radius-sm` | 4px | Small chips, badges |
| `--radius-base` | 6px | Buttons, cells, inputs |
| `--radius-md` | 8px | Cards, modals |
| `--radius-lg` | 12px | Large panels |
| `--radius-pill` | 9999px | Pills, avatars |

---

## Shadows / Elevation

Subtle, Monday-style.

| Token | Value | Usage |
|---|---|---|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.04)` | Cards, table rows |
| `--shadow-md` | `0 2px 8px rgba(0,0,0,0.08)` | Dropdowns, popovers |
| `--shadow-lg` | `0 4px 16px rgba(0,0,0,0.12)` | Modals |
| `--shadow-xl` | `0 8px 32px rgba(0,0,0,0.16)` | Important modals |

---

## Borders

- **Default:** `1px solid var(--border-light)` — `#E6E9EF`
- **Input/focus:** `2px solid var(--primary-blue)`
- **Strong:** `1px solid var(--border-medium)`

Cells in table view have very subtle borders — almost imperceptible greys.

---

## Pills / Labels (the core visual element)

```css
.pill {
  display: inline-flex;
  align-items: center;
  height: 24px;
  padding: 0 12px;
  border-radius: var(--radius-pill);
  font-size: var(--text-xs);
  font-weight: 500;
  color: white;
  background: var(--label-color);
}
```

- All pills have a consistent height (24px)
- Color comes from label config
- Text is white on saturated bgs, dark on light bgs (auto-contrast)
- Rounded corners (full pill or 6px radius for table cells)

### Table cell variant
Inside table cells, pills fill the entire cell height with rounded corners 4-6px, not full pill. This is Monday's distinctive look.

---

## Buttons

### Primary
- Bg: `--primary-blue`
- Text: white
- Padding: 8px 16px
- Radius: `--radius-base`
- Hover: darker blue
- Disabled: 40% opacity

### Secondary
- Bg: white
- Border: `1px solid --border-medium`
- Text: `--text-primary`
- Hover: `--bg-hover`

### Ghost
- Bg: transparent
- Text: `--text-primary`
- Hover: `--bg-hover`

### Icon Button
- 32x32 square
- Icon centered
- Hover: `--bg-hover`
- Active/selected: `--bg-selected`

### Toolbar Button
- Icon + label
- Padding: 6px 10px
- Hover: `--bg-hover`

---

## Inputs

- Height: 36px standard, 32px small
- Padding: 8px 12px
- Border: `1px solid --border-medium`
- Focus: `2px solid --primary-blue`, no other change
- Placeholder: `--text-disabled`
- Radius: `--radius-base`

---

## Avatars

- Circle
- Background: gradient if no image (initials)
- Sizes: xs(20px), sm(24px), md(32px), lg(40px), xl(64px)
- Multi-stack: overlap with -8px margin, max 4 visible + "+N"

### Initials background
- Generated from name hash → consistent color per user
- Use the label palette colors

---

## Iconography

- **Library:** Lucide (matches Monday's icon vibe) or Phosphor
- **Stroke width:** 1.5 (or 2 for small icons)
- **Default size:** 16px (inline), 20px (toolbars), 24px (page headers)
- **Color:** inherits text color, often `--text-secondary`

---

## Hover / Focus / Active States

- **Hover bg:** light grey (`--bg-hover`)
- **Focus ring:** 2px solid primary blue, 2px offset
- **Active/pressed:** slightly darker than hover
- **Selected (e.g., row):** light blue tint (`--bg-selected`)

---

## Animation

Keep it subtle and fast.

| Animation | Duration | Easing |
|---|---|---|
| Hover transitions | 100ms | ease-out |
| Dropdown open | 150ms | ease-out |
| Modal in | 200ms | cubic-bezier(0.32,0.72,0,1) |
| Panel slide-in | 250ms | cubic-bezier(0.32,0.72,0,1) |
| Toast slide | 200ms | ease-out |
| Skeleton shimmer | 1500ms infinite | linear |

**Avoid:**
- Bouncy animations
- Long durations (>300ms)
- Confetti / decorative
- Page transitions (just snap)

---

## Special Visual Elements

### Group color bar
- Left edge of group rows
- 4px wide vertical bar
- Color = group color
- Continues from group header down through all rows

### Status distribution bar
- Below collapsed groups, in column footer
- Horizontal stacked bar of label colors
- Width proportional to count
- ~12px tall, rounded ends

### Drag handle
- ⠿ pattern (6 dots, 2 columns of 3)
- Color: `--text-disabled`
- Cursor: `grab` on hover, `grabbing` on drag
- Only visible on row hover

### Comments / subitems icons on cards
- Small (12-14px)
- Grey with count
- Click to expand

---

## Dark Mode

V1 supports dark mode toggle.

| Token | Light | Dark |
|---|---|---|
| `--bg-app` | `#F6F7FB` | `#1A1B22` |
| `--bg-surface` | `#FFFFFF` | `#2A2C36` |
| `--bg-hover` | `#F5F6FA` | `#353845` |
| `--bg-selected` | `#E6F0FA` | `#1B3145` |
| `--bg-dark` | `#292F4C` | `#0F1018` |
| `--text-primary` | `#323338` | `#E4E5EA` |
| `--text-secondary` | `#676879` | `#A0A3B0` |
| `--border-light` | `#E6E9EF` | `#3A3D4A` |

Label colors stay the same in both modes (saturation works on both bgs).

---

## Empty States

- Centered in available space
- Vertical stack
- Illustration (~200x200px, soft / friendly)
- Headline (text-lg, weight 600)
- Subtext (text-sm, secondary color)
- CTA button (primary or ghost)

Examples:
- Empty board: "Add your first task" + arrow pointing to + button
- Empty notifications: "You rock!" + 🤚 illustration
- Empty inbox: "All caught up!" + ☕ icon
- Empty dashboard: "Visualize data from multiple boards"

---

## Loading States

- **Skeleton rows** for table data (animated grey blocks)
- **Spinner** for buttons (small, inline)
- **Progress bars** for uploads (with %)
- **Shimmer** on cards loading

Avoid full-page blocking spinners — use skeletons.

---

## Toast Notifications

- Top-right corner (or bottom-center on mobile)
- Slide in from edge
- Auto-dismiss 4s default
- Hover to pause dismiss
- Click ✕ to dismiss

Types:
- Success: green left border, ✓ icon
- Error: red left border, ⚠ icon
- Info: blue left border, ℹ icon
- Warning: orange left border, ⚠ icon

---

## Special Vibe View Styling (Gemini-Generated UIs)

When Gemini generates a Vibe view, it should output:
- HTML that uses **CSS variables from this design system**
- Tailwind classes (if simpler)
- Stays consistent with PMS look — even though generated

We'll inject our design tokens into Gemini's prompt so output matches.

---

## Logo / Branding (Confirmed by User)

- **NO logo image in V1** — confirmed
- **Use company name as text-only "logo"** in top-left of app
- Styling:
  - Font: same as app font (Roboto bold)
  - Size: ~20px, weight 700
  - Color: white (on dark header bar)
  - Spacing: small letter-spacing for cleanness
- Favicon: simple "P" or first letter of company name on solid color square (placeholder)
- Loading screen: company name + subtle spinner

### Future logo (not now)
- Will design actual logo later
- Until then, text-only is sufficient
- Easy to swap in image later when ready

---

## Accessibility

- **Contrast:** AAA on body text, AA on labels
- **Focus visible:** always show focus ring on keyboard nav
- **Screen reader:** semantic HTML, ARIA where needed
- **Keyboard nav:** all actions reachable without mouse
- **Color-blind:** never use color alone — pair with icon/text
- **Text size:** all text scalable, no fixed pixel issues on zoom

---

## Mobile Considerations

V1 is web-responsive only. Native apps are V3.

- Touch targets minimum 44x44px
- No hover states — use long-press or tap
- Table → list collapse on small screens
- Bottom navigation bar on mobile (Workspace / Inbox / Notifications / Profile)
- Swipe gestures for common actions (swipe row to archive)

---

## Iconography (Specific to PMS)

Identified from screenshots:

| Element | Icon |
|---|---|
| Workspace | 4-square grid icon |
| Board | Document with side stripe |
| Doc | Document |
| Dashboard | Chart-grid icon |
| Folder | Folder |
| Item | Single line |
| Subitem | Indent arrow |
| Status | Colored dot |
| People | Person silhouette |
| Date | Calendar |
| Files | Paperclip or stacked papers |
| Activity | Clock + arrow |
| Notifications | Bell |
| Inbox | Tray |
| Search | Magnifying glass |
| Settings | Gear |
| AI Sidekick | ✨ Sparkles |
| Vibe View | 💗 Heart-shaped sparkle |
| Automate | ⚡ Lightning |
| Integrate | 🧩 Puzzle piece |
| Filter | Funnel |
| Sort | Up-down arrows |
| Hide | Eye |
| Group by | Stacked layers |

---

## Document Status

| Field | Value |
|---|---|
| **Version** | 0.2 |
| **Status** | Locked — exact Monday-clone direction confirmed |
| **Confirmed by user** | • Exact Monday layout, fonts, colors, spacing<br>• Brand color: Monday blue `#0073EA`<br>• No logo image — company name text only<br>• Reason: employee adoption (change-resistant team) |

---

> **Next doc:** `08-tech-stack-and-architecture.md` — Lovable / Supabase / Gemini specifics.
