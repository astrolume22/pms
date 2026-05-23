/**
 * CLIENT TWIN of api/_shared/color-normalize.ts.
 *
 * Same canonical color → #RRGGBB hex normalizer; same OKLab math; same
 * chip-token table. Used by the LabelPicker / LabelsEditorModal write
 * paths so the client and the MCP server agree on one storage format.
 *
 * ⚠️ KEEP IN SYNC with api/_shared/color-normalize.ts. Grep both files
 *    for "SERVER TWIN" / "CLIENT TWIN" to find the pair. Sharing one
 *    source is deferred for the same Vite-vs-Vercel-NodeNext reason
 *    documented on the applier twins.
 */

function oklchToHex(L: number, C: number, hDeg: number): string {
  const hRad = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  let l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  let m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  let s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  l_ = l_ * l_ * l_;
  m_ = m_ * m_ * m_;
  s_ = s_ * s_ * s_;

  const r = +4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_;
  const g = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_;
  const bl = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_;

  const gam = (c: number): number =>
    c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
  const R = clamp01(gam(r));
  const G = clamp01(gam(g));
  const B = clamp01(gam(bl));

  const hex2 = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${hex2(R)}${hex2(G)}${hex2(B)}`;
}

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

const NAME_HEX: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const [k, hex] of Object.entries(TOKEN_HEX)) m[k] = hex;
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

export const DEFAULT_LABEL_HEX = TOKEN_HEX.slate;

export function toCanonicalHex(input: string | null | undefined): string {
  if (input == null) return DEFAULT_LABEL_HEX;
  const raw = String(input).trim();
  if (raw.length === 0) return DEFAULT_LABEL_HEX;

  const longHex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(raw);
  if (longHex) return `#${longHex[1].toUpperCase()}`;

  const shortHex = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(raw);
  if (shortHex) {
    const [, r, g, b] = shortHex;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }

  const oklch = /^oklch\(\s*([\d.]+)%?\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)(?:\s*\/\s*[\d.%]+)?\s*\)$/i.exec(raw);
  if (oklch) {
    let L = parseFloat(oklch[1]);
    const C = parseFloat(oklch[2]);
    const h = parseFloat(oklch[3]);
    if (raw.includes('%')) L = L / 100;
    if (Number.isFinite(L) && Number.isFinite(C) && Number.isFinite(h)) {
      return oklchToHex(L, C, h);
    }
  }

  const cssVar = /^var\(\s*--chip-([a-z]+)\s*(?:,\s*[^)]+)?\s*\)$/i.exec(raw);
  if (cssVar) {
    const tok = cssVar[1].toLowerCase();
    if (tok in TOKEN_HEX) return TOKEN_HEX[tok as ChipToken];
    if (tok in NAME_HEX)  return NAME_HEX[tok];
  }

  const lower = raw.toLowerCase();
  if (lower in NAME_HEX) return NAME_HEX[lower];

  return DEFAULT_LABEL_HEX;
}

export interface DefaultColorContext {
  columnType?: string;
  columnName?: string;
  labelName: string;
  positionInColumn?: number;
  totalInColumn?: number;
}

export function defaultLabelHexFor(ctx: DefaultColorContext): string {
  const t = (ctx.columnType ?? '').toLowerCase();
  const cName = (ctx.columnName ?? '').toLowerCase().replace(/\s+/g, '');
  const n = ctx.labelName.toLowerCase();

  if (t === 'status') {
    if (/(not[\s_-]?started|pending|todo|to[\s_-]?do|new|backlog|unassigned)/.test(n)) return TOKEN_HEX.slate;
    if (/(done|complete|complet|finished|shipped)/.test(n))                            return TOKEN_HEX.mint;
    if (/(urgent|overdue|escalate)/.test(n))                                            return TOKEN_HEX.pink;
    if (/(blocked|stuck|hold|wait)/.test(n))                                            return TOKEN_HEX.teal;
    if (/(review|qa|test|on[\s_-]?hold)/.test(n))                                       return TOKEN_HEX.purple;
    if (/(in[\s_-]?progress|progress|working|active|started)/.test(n))                  return TOKEN_HEX.amber;
    return TOKEN_HEX.slate;
  }

  if (t === 'priority' || cName === 'priority') {
    if (/(high|urgent|critical|p1|p0)/.test(n))   return TOKEN_HEX.purple;
    if (/(medium|med|normal|p2)/.test(n))         return TOKEN_HEX.sky;
    if (/(low|p3|p4|trivial|minor)/.test(n))      return TOKEN_HEX.slate;
    return TOKEN_HEX.sky;
  }

  if (cName === 'tasktype' || cName === 'type') {
    const rotation: ChipToken[] = ['teal', 'purple', 'mint'];
    const idx = (ctx.positionInColumn ?? 0) % rotation.length;
    return TOKEN_HEX[rotation[idx]];
  }

  if (cName === 'coworktime' || cName === 'workime' || cName === 'duration' || cName === 'worktime') {
    const pos = Math.max(0, ctx.positionInColumn ?? 0);
    const total = Math.max(1, ctx.totalInColumn ?? 1);
    const lightness = total > 1 ? 0.78 - (pos / (total - 1)) * 0.40 : 0.70;
    return oklchToHex(lightness, 0.12, 230);
  }

  const rotation: ChipToken[] = ['mint', 'amber', 'coral', 'sky', 'purple', 'pink', 'teal', 'slate'];
  const idx = (ctx.positionInColumn ?? 0) % rotation.length;
  return TOKEN_HEX[rotation[idx]];
}

export function tokenHex(t: ChipToken): string {
  return TOKEN_HEX[t];
}

/**
 * Case-insensitive hex equality. Use this for the ColorSwatch selected-
 * state highlight: previously the swatch did `value === c` which broke
 * because some labels were stored as `oklch(...)` and others as hex with
 * different case. Normalising both sides to canonical hex makes the
 * check work for every label regardless of how its color was written.
 */
export function colorsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  return toCanonicalHex(a) === toCanonicalHex(b);
}
