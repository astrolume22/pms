/**
 * Token-anchored chip color HELPERS for the premium polish pass.
 *
 * BEHAVIOUR CHANGE (label-color bug fix):
 *   Previously chipColorFor() OVERRODE label.color at render time for
 *   Status / Priority / Task Type / Co-Work Time columns — it derived
 *   the color from the label name (so "Done" always rendered mint
 *   regardless of what the DB stored). That hid every user/MCP color
 *   edit and made the heatmap visuals look impossible to customise.
 *
 *   New contract: chipColorFor() honours label.color as the SOURCE OF
 *   TRUTH. The keyword classifier is still exported (defaultLabelHexFor
 *   in src/lib/colorNormalize.ts) but it's invoked at CREATE time, not
 *   at RENDER time, so brand-new "Done" labels still seed mint by
 *   default while users / MCP can recolor anything afterwards.
 *
 *   Date — DateCell still handles today/tomorrow/overdue tints inline.
 *
 * Falls back to label.color verbatim when set; falls back to the
 * neutral chip-slate when not.
 */
import type { ColumnRow, ColumnLabelRow } from './database.types';
import { DEFAULT_LABEL_HEX } from './colorNormalize';

// ChipToken kept here for any caller that still imports it; the
// canonical token registry now lives in src/lib/colorNormalize.ts.
export type ChipToken =
  | 'amber' | 'slate' | 'teal' | 'pink'
  | 'purple' | 'sky' | 'mint' | 'coral';

export function chipColorFor(
  _column: ColumnRow,
  label: ColumnLabelRow,
  _positionInColumn: number,
  _totalInColumn: number,
): string {
  // BEHAVIOUR CHANGE (label-color bug fix): RENDER honours label.color
  // verbatim for every column type. The keyword/position classifiers
  // (classifyStatus, classifyPriority, the Task Type rotation, the
  // Co-Work Time lightness ramp) are gone from the render path — they
  // live in colorNormalize.defaultLabelHexFor() and run ONLY at label-
  // create time. This means a user (or MCP) can recolor "Done" pink
  // and the chip will actually render pink. Brand-new "Done" labels
  // still seed mint via the create-time default so the heatmap
  // intuition is preserved without locking out customization.
  //
  // The arguments column/position/total are kept in the signature for
  // backward compatibility with existing call sites (LabelCell,
  // LabelPicker, SummaryStrip) — they're no longer consulted here.
  return label.color || DEFAULT_LABEL_HEX;
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
