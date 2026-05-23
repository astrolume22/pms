/**
 * Canonical color → #RRGGBB hex normalizer.
 *
 * Single end-to-end format for column_labels.color (and any other
 * label-style color we store). All write paths (MCP tools + UI hooks)
 * funnel through toCanonicalHex() so the DB is uniform hex, the
 * renderer can read it verbatim, and string equality works.
 *
 * Accepts:
 *   - #RRGGBB                       (canonical — passes through, uppercased)
 *   - #RGB                          (expanded to #RRGGBB)
 *   - oklch(L C H)                  (converted to nearest hex via OKLab math;
 *                                    the 8 chip tokens are precomputed for
 *                                    exact round-trips)
 *   - var(--chip-X)                 (resolved against the token table)
 *   - bare token names              ("mint", "amber", "red", "sky" …)
 *   - common CSS color names        ("red", "green", "navy", "gray", …)
 *
 * Falls back to a sensible neutral (chip-slate hex) on unrecognized input
 * so a malformed caller never breaks the write — the response includes
 * the canonical hex so the LLM sees what landed.
 *
 * ⚠️ CLIENT TWIN: src/lib/colorNormalize.ts mirrors this file. Keep them
 *    in sync — the chip-token table + the OKLab math live in both.
 */

// ---------------------------------------------------------------------
// OKLCH → linear sRGB → sRGB hex
// (Björn Ottosson's matrices: https://bottosson.github.io/posts/oklab/)
// ---------------------------------------------------------------------
function oklchToHex(L: number, C: number, hDeg: number): string {
  // OKLCH → OKLab
  const hRad = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  // OKLab → LMS (linear)
  let l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  let m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  let s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  l_ = l_ * l_ * l_;
  m_ = m_ * m_ * m_;
  s_ = s_ * s_ * s_;

  // LMS → linear sRGB
  const r = +4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_;
  const g = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_;
  const bl = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_;

  // Linear → sRGB gamma
  const gam = (c: number): number =>
    c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
  const R = clamp01(gam(r));
  const G = clamp01(gam(g));
  const B = clamp01(gam(bl));

  const hex2 = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${hex2(R)}${hex2(G)}${hex2(B)}`;
}

// ---------------------------------------------------------------------
// Chip tokens — single source of truth. Tokens are defined as oklch
// triples (the design system's canonical form), with the hex computed
// once at module load via oklchToHex so there's zero drift.
// ---------------------------------------------------------------------
const TOKEN_OKLCH = {
  amber:  { l: 0.72, c: 0.15, h: 70  },
  slate:  { l: 0.45, c: 0.02, h: 250 },
  teal:   { l: 0.55, c: 0.10, h: 200 },
  pink:   { l: 0.62, c: 0.18, h: 350 },
  purple: { l: 0.62, c: 0.15, h: 295 },
  sky:    { l: 0.70, c: 0.12, h: 230 },
  mint:   { l: 0.72, c: 0.14, h: 160 },
  coral:  { l: 0.68, c: 0.16, h: 25  },
} as const;
export type ChipToken = keyof typeof TOKEN_OKLCH;

export const TOKEN_HEX: Record<ChipToken, string> =
  (Object.fromEntries(
    (Object.entries(TOKEN_OKLCH) as [ChipToken, { l: number; c: number; h: number }][])
      .map(([k, v]) => [k, oklchToHex(v.l, v.c, v.h)]),
  )) as Record<ChipToken, string>;

// ---------------------------------------------------------------------
// Bare-name → hex alias table. Covers the 8 design tokens plus a handful
// of natural English color names an LLM might emit so the normalizer
// doesn't trip on common shortcuts.
// ---------------------------------------------------------------------
const NAME_HEX: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  // Tokens
  for (const [k, hex] of Object.entries(TOKEN_HEX)) m[k] = hex;
  // CSS-color name aliases — mapped to the nearest design-token hex
  // so colors stay within the family. (We pick palette tokens, not the
  // CSS spec's "red", because the design token band is gentler.)
  m.red       = TOKEN_HEX.pink;
  m.crimson   = TOKEN_HEX.pink;
  m.magenta   = TOKEN_HEX.pink;
  m.green     = TOKEN_HEX.mint;
  m.emerald   = TOKEN_HEX.mint;
  m.lime      = TOKEN_HEX.mint;
  m.blue      = TOKEN_HEX.sky;
  m.navy      = TOKEN_HEX.sky;
  m.cyan      = TOKEN_HEX.teal;
  m.aqua      = TOKEN_HEX.teal;
  m.orange    = TOKEN_HEX.coral;
  m.yellow    = TOKEN_HEX.amber;
  m.gold      = TOKEN_HEX.amber;
  m.violet    = TOKEN_HEX.purple;
  m.lavender  = TOKEN_HEX.purple;
  m.indigo    = TOKEN_HEX.purple;
  m.grey      = TOKEN_HEX.slate;
  m.gray      = TOKEN_HEX.slate;
  m.neutral   = TOKEN_HEX.slate;
  return m;
})();

// ---------------------------------------------------------------------
// Neutral fallback — used when input is empty / unrecognized. This is
// the chip-slate hex (matches the visual-polish design tokens), not
// the legacy #C4C4C4 we used previously.
// ---------------------------------------------------------------------
export const DEFAULT_LABEL_HEX = TOKEN_HEX.slate;

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------

/**
 * Convert any supported color input to a canonical "#RRGGBB" hex string.
 * Never throws — unrecognized input degrades to DEFAULT_LABEL_HEX so
 * label writes don't fail because the caller sent an exotic format.
 *
 * The output is always uppercase 7-char hex.
 */
export function toCanonicalHex(input: string | null | undefined): string {
  if (input == null) return DEFAULT_LABEL_HEX;
  const raw = String(input).trim();
  if (raw.length === 0) return DEFAULT_LABEL_HEX;

  // #RRGGBB / #RRGGBBaa — canonical, just normalize case + strip alpha.
  const longHex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(raw);
  if (longHex) return `#${longHex[1].toUpperCase()}`;

  // #RGB — expand each digit.
  const shortHex = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(raw);
  if (shortHex) {
    const [, r, g, b] = shortHex;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }

  // oklch(L C H)  — accepts comma OR space separation, optional %.
  const oklch = /^oklch\(\s*([\d.]+)%?\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)(?:\s*\/\s*[\d.%]+)?\s*\)$/i.exec(raw);
  if (oklch) {
    let L = parseFloat(oklch[1]);
    const C = parseFloat(oklch[2]);
    const h = parseFloat(oklch[3]);
    // % form: oklch(72% 0.15 70) — divide by 100.
    if (raw.includes('%')) L = L / 100;
    if (Number.isFinite(L) && Number.isFinite(C) && Number.isFinite(h)) {
      return oklchToHex(L, C, h);
    }
  }

  // var(--chip-X) — extract X, look up in TOKEN_HEX.
  const cssVar = /^var\(\s*--chip-([a-z]+)\s*(?:,\s*[^)]+)?\s*\)$/i.exec(raw);
  if (cssVar) {
    const tok = cssVar[1].toLowerCase();
    if (tok in TOKEN_HEX) return TOKEN_HEX[tok as ChipToken];
    if (tok in NAME_HEX)  return NAME_HEX[tok];
  }

  // Bare name — "mint", "red", etc.
  const lower = raw.toLowerCase();
  if (lower in NAME_HEX) return NAME_HEX[lower];

  // Nothing matched — return the neutral default rather than throwing
  // (the response surfaces the canonical hex so callers see what landed).
  return DEFAULT_LABEL_HEX;
}

// ---------------------------------------------------------------------
// Smart create-time defaults for label color, based on label NAME and
// column type. Returns hex. This is the helper UI + MCP call when no
// color is supplied: the renderer no longer overrides at render time
// (that was the bug), so we apply the heuristic ONCE at write-time so
// new labels still seed in palette and boards look like a heatmap by
// default.
//
// Keep the keyword lists in sync with chipColorFor's classifier intent.
// ---------------------------------------------------------------------
export interface DefaultColorContext {
  columnType?: string;
  columnName?: string;
  labelName: string;
  /** Position in the column (for ordinal columns like Co-Work Time). */
  positionInColumn?: number;
  /** Total labels in the column (for the ordinal ramp). */
  totalInColumn?: number;
}

export function defaultLabelHexFor(ctx: DefaultColorContext): string {
  const t = (ctx.columnType ?? '').toLowerCase();
  const cName = (ctx.columnName ?? '').toLowerCase().replace(/\s+/g, '');
  const n = ctx.labelName.toLowerCase();

  // Status — match the keyword classifier so brand-new "Done" / "Stuck"
  // labels seed mint / teal as expected.
  if (t === 'status') {
    if (/(not[\s_-]?started|pending|todo|to[\s_-]?do|new|backlog|unassigned)/.test(n)) return TOKEN_HEX.slate;
    if (/(done|complete|complet|finished|shipped)/.test(n))                            return TOKEN_HEX.mint;
    if (/(urgent|overdue|escalate)/.test(n))                                            return TOKEN_HEX.pink;
    if (/(blocked|stuck|hold|wait)/.test(n))                                            return TOKEN_HEX.teal;
    if (/(review|qa|test|on[\s_-]?hold)/.test(n))                                       return TOKEN_HEX.purple;
    if (/(in[\s_-]?progress|progress|working|active|started)/.test(n))                  return TOKEN_HEX.amber;
    return TOKEN_HEX.slate;
  }

  // Priority — keep the classifier intent.
  if (t === 'priority' || cName === 'priority') {
    if (/(high|urgent|critical|p1|p0)/.test(n))   return TOKEN_HEX.purple;
    if (/(medium|med|normal|p2)/.test(n))         return TOKEN_HEX.sky;
    if (/(low|p3|p4|trivial|minor)/.test(n))      return TOKEN_HEX.slate;
    return TOKEN_HEX.sky;
  }

  // Task Type — position-based rotation among teal/purple/mint.
  if (cName === 'tasktype' || cName === 'type') {
    const rotation: ChipToken[] = ['teal', 'purple', 'mint'];
    const idx = (ctx.positionInColumn ?? 0) % rotation.length;
    return TOKEN_HEX[rotation[idx]];
  }

  // Co-Work Time — single-hue ordinal ramp on sky. Compute lightness
  // along [0.78, 0.38] proportional to position; chroma fixed at 0.12.
  if (cName === 'coworktime' || cName === 'workime' || cName === 'duration' || cName === 'work time'.replace(/\s+/g, '')) {
    const pos = Math.max(0, ctx.positionInColumn ?? 0);
    const total = Math.max(1, ctx.totalInColumn ?? 1);
    const lightness = total > 1 ? 0.78 - (pos / (total - 1)) * 0.40 : 0.70;
    return oklchToHex(lightness, 0.12, 230);
  }

  // Generic / custom dropdown — pick the next token in the chip rotation
  // by position so successive labels are visually distinct.
  const rotation: ChipToken[] = ['mint', 'amber', 'coral', 'sky', 'purple', 'pink', 'teal', 'slate'];
  const idx = (ctx.positionInColumn ?? 0) % rotation.length;
  return TOKEN_HEX[rotation[idx]];
}

/**
 * Convenience: resolve a token name → hex. Useful for code that needs
 * the chip palette inline (e.g. seed-color rotations).
 */
export function tokenHex(t: ChipToken): string {
  return TOKEN_HEX[t];
}
