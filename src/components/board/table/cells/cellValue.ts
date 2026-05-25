/**
 * Cell-value normalizer.
 *
 * The board has accumulated TWO write paths over its lifetime:
 *   • UI hooks (status / priority / label edit) write the canonical
 *     flat shape, e.g. {label_id:'…'}, {date:'2026-05-26'},
 *     {text:'…'}, {value: 42}, {url:'…',text:'…'}, {checked:true}.
 *   • The MCP server / AI applier (`update_task_cell`) accepts the
 *     LLM-natural input and historically wrote a *wrapped* envelope:
 *         {"value": "{\"date\":\"2026-05-26\"}"}
 *         {"value": "{\"text\":\"10:00\"}"}
 *     i.e. the canonical payload as a JSON STRING under `value`.
 *
 * Status / priority dodge the bug because they store `{label_id:'…'}`
 * which has no `value` key. Date and Text cells hit it directly: the
 * renderer reads `value.date` / `value.text` and finds nothing, so
 * the cell paints empty even though the row IS in the DB.
 *
 * `unwrapCellValue` peels exactly that one envelope per call, until
 * the canonical shape is reached. It also handles a raw stored string
 * (in case any path serialized the whole object as JSON text).
 *
 * Pure, deterministic, no side effects. Safe to call on already-flat
 * payloads — they pass through unchanged.
 */

const MAX_DEPTH = 3;

function tryParseJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return undefined; }
}

export function unwrapCellValue(raw: unknown): unknown {
  let cur = raw;
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    if (cur == null) return cur;

    // Stored as a JSON string somewhere upstream? Parse and continue.
    if (typeof cur === 'string') {
      const parsed = tryParseJson(cur);
      // Only unwrap when the string truly looks like a JSON payload
      // (object/array). A plain "2026-05-26" or "10:00 AM" string
      // should be returned as-is so date/text cells can recognize it.
      if (parsed && (typeof parsed === 'object')) {
        cur = parsed;
        continue;
      }
      return cur;
    }

    if (typeof cur !== 'object') return cur;

    // Detect the MCP `{value: "<json-string>"}` envelope.
    // We ONLY unwrap when:
    //   (a) the object has a `value` key whose value is a STRING, AND
    //   (b) that string parses as JSON object.
    // NumbersCell's canonical {value: 42} has value:number — never
    // matches, never unwrapped. LinkCell's canonical {url,text} has
    // no `value` key — never matches.
    const obj = cur as Record<string, unknown>;
    if (typeof obj.value === 'string') {
      const inner = tryParseJson(obj.value);
      if (inner && typeof inner === 'object') {
        cur = inner;
        continue;
      }
    }
    return cur;
  }
  return cur;
}

// -----------------------------------------------------------------
// Convenience typed readers per cell shape.
// -----------------------------------------------------------------

export function readDateValue(raw: unknown): string | null {
  const v = unwrapCellValue(raw);
  // Canonical: {date: '2026-05-26'}
  if (v && typeof v === 'object' && 'date' in v) {
    const d = (v as { date?: string | null }).date;
    return typeof d === 'string' && d.length > 0 ? d : null;
  }
  // Plain ISO string somehow stored directly: '2026-05-26'
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return null;
}

export function readTextValue(raw: unknown): string {
  const v = unwrapCellValue(raw);
  // Canonical: {text: '…'}
  if (v && typeof v === 'object' && 'text' in v) {
    const t = (v as { text?: string | null }).text;
    return typeof t === 'string' ? t : '';
  }
  // Plain string stored directly.
  if (typeof v === 'string') return v;
  return '';
}

export function readNumberValue(raw: unknown): number | null {
  const v = unwrapCellValue(raw);
  // Canonical: {value: <number>}
  if (v && typeof v === 'object' && 'value' in v) {
    const n = (v as { value?: number | string | null }).value;
    if (typeof n === 'number' && Number.isFinite(n)) return n;
    if (typeof n === 'string' && n.trim() !== '' && !Number.isNaN(Number(n))) return Number(n);
  }
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

export function readCheckboxValue(raw: unknown): boolean {
  const v = unwrapCellValue(raw);
  if (v && typeof v === 'object' && 'checked' in v) {
    return Boolean((v as { checked?: boolean }).checked);
  }
  if (typeof v === 'boolean') return v;
  return false;
}

export function readLinkValue(raw: unknown): { url: string; text: string } {
  const v = unwrapCellValue(raw);
  if (v && typeof v === 'object') {
    const obj = v as { url?: string; text?: string };
    return { url: obj.url ?? '', text: obj.text ?? '' };
  }
  if (typeof v === 'string') return { url: v, text: '' };
  return { url: '', text: '' };
}
