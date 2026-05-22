/**
 * Token-anchored chip colors for the premium polish pass.
 *
 * Every categorical column on the board renders with a token color from
 * the OKLCH chip palette so the whole row reads as one color family.
 * Source of truth for "which token does this label get":
 *
 *   • Status        — label-name keyword:
 *       in-progress / working    → amber
 *       not-started / pending    → slate
 *       blocked / stuck          → teal (deep)
 *       urgent / overdue         → pink
 *       review / on-hold         → purple
 *       done / complete          → mint
 *   • Priority      — label-name keyword:
 *       high / urgent / critical → purple
 *       medium / normal          → sky
 *       low                      → slate
 *   • Task Type     — by index (sort_order) into a 3-hue rotation:
 *       teal → purple → mint, repeating.
 *   • Co-Work Time  — ordinal gradient of --chip-sky, light→dark by
 *       label sort_order. ONE hue (the user spec).
 *   • Date          — handled inline in DateCell (today/tomorrow/
 *       overdue/future), not here.
 *
 * Falls back to label.color if no mapping matches — so columns that
 * aren't one of the named categories still render their stored color.
 */
import type { ColumnRow, ColumnLabelRow } from './database.types';

export type ChipToken =
  | 'amber' | 'slate' | 'teal' | 'pink'
  | 'purple' | 'sky' | 'mint' | 'coral';

const TOKEN_TO_VAR: Record<ChipToken, string> = {
  amber:  'var(--chip-amber)',
  slate:  'var(--chip-slate)',
  teal:   'var(--chip-teal)',
  pink:   'var(--chip-pink)',
  purple: 'var(--chip-purple)',
  sky:    'var(--chip-sky)',
  mint:   'var(--chip-mint)',
  coral:  'var(--chip-coral)',
};

export function tokenColor(t: ChipToken): string {
  return TOKEN_TO_VAR[t];
}

// Lightness ramp for ordinal columns (Co-Work Time). Map a label's
// sort_order or its position in the column → a single-hue rendering
// at decreasing lightness so longer durations read as deeper chips.
const ORDINAL_LIGHTNESS = [0.80, 0.72, 0.64, 0.56, 0.48, 0.40, 0.34, 0.28];

function classifyStatus(name: string): ChipToken {
  const n = name.toLowerCase();
  // Order matters: "Not Started" must hit the slate branch before the
  // amber /started/ branch, otherwise "started" inside "not started"
  // captures it. Negative-state keywords are checked first.
  if (/(not[\s_-]?started|pending|todo|to[\s_-]?do|new|backlog|unassigned)/.test(n)) return 'slate';
  if (/(done|complete|complet|finished|shipped)/.test(n))                            return 'mint';
  if (/(urgent|overdue|escalate)/.test(n))                                            return 'pink';
  if (/(blocked|stuck|hold|wait)/.test(n))                                            return 'teal';
  if (/(review|qa|test|on[\s_-]?hold)/.test(n))                                       return 'purple';
  if (/(in[\s_-]?progress|progress|working|active|started)/.test(n))                  return 'amber';
  return 'slate';
}

function classifyPriority(name: string): ChipToken {
  const n = name.toLowerCase();
  if (/(high|urgent|critical|p1|p0)/.test(n))   return 'purple';
  if (/(medium|med|normal|p2)/.test(n))         return 'sky';
  if (/(low|p3|p4|trivial|minor)/.test(n))      return 'slate';
  return 'sky';
}

const TASK_TYPE_ROTATION: ChipToken[] = ['teal', 'purple', 'mint'];

function isColumnNamed(column: ColumnRow, names: string[]): boolean {
  const n = (column.name ?? '').trim().toLowerCase();
  return names.some((m) => n === m || n.replace(/\s+/g, '') === m.replace(/\s+/g, ''));
}

export function chipColorFor(
  column: ColumnRow,
  label: ColumnLabelRow,
  positionInColumn: number,
  totalInColumn: number,
): string {
  // --- Status -------------------------------------------------------
  if (column.column_type === 'status') {
    return tokenColor(classifyStatus(label.name));
  }
  // --- Priority -----------------------------------------------------
  if (column.column_type === 'priority' || isColumnNamed(column, ['priority'])) {
    return tokenColor(classifyPriority(label.name));
  }
  // --- Task Type (named column rendered as a dropdown/status) -------
  if (isColumnNamed(column, ['task type', 'type'])) {
    return tokenColor(TASK_TYPE_ROTATION[positionInColumn % TASK_TYPE_ROTATION.length]);
  }
  // --- Co-Work Time — ordinal gradient on a single hue (sky) --------
  if (isColumnNamed(column, ['co-work time', 'cowork time', 'co work time', 'work time', 'duration'])) {
    const idx = Math.min(ORDINAL_LIGHTNESS.length - 1, positionInColumn);
    const total = Math.max(1, totalInColumn);
    // Use a linear ramp between 0.80 and 0.40 so even a 2-label column
    // still shows light→dark; chroma stays in the palette band.
    const lightness = total > 1
      ? 0.78 - (positionInColumn / (total - 1)) * 0.40
      : ORDINAL_LIGHTNESS[idx];
    return `oklch(${lightness.toFixed(3)} 0.12 230)`;
  }
  // --- Default: trust whatever was stored on the label --------------
  return label.color;
}

/**
 * Date relative-time tint per spec (criterion 3):
 *   • Today    → amber
 *   • Tomorrow → sky
 *   • Overdue  → pink
 *   • Future   → slate (neutral, just date text — no big chip)
 */
export type DateTone = 'today' | 'tomorrow' | 'overdue' | 'future' | 'empty';

export function dateToneFor(ymd: string | null | undefined): DateTone {
  if (!ymd) return 'empty';
  const today = todayYmd();
  if (ymd < today) return 'overdue';
  if (ymd === today) return 'today';
  if (ymd === addDaysYmd(today, 1)) return 'tomorrow';
  return 'future';
}

export function dateChipColor(tone: DateTone): string | null {
  switch (tone) {
    case 'today':    return 'var(--chip-amber)';
    case 'tomorrow': return 'var(--chip-sky)';
    case 'overdue':  return 'var(--chip-pink)';
    default:         return null;       // future / empty → neutral row fill
  }
}

function todayYmd(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysYmd(ymd: string, days: number): string {
  const [yy, mm, dd] = ymd.split('-').map(Number);
  const d = new Date(yy, mm - 1, dd);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
