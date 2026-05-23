/**
 * Read-only probe — dump real column_labels.color values across the
 * system so we can SEE what format(s) are actually stored, then
 * categorise them so the diagnosis is grounded in real data.
 */
import './loadEnv';
import { createClient } from '@supabase/supabase-js';

const SB = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } });

function classify(c: string): string {
  if (!c) return 'EMPTY';
  if (/^#[0-9A-Fa-f]{6}$/.test(c)) return 'hex#RRGGBB';
  if (/^#[0-9A-Fa-f]{3}$/.test(c)) return 'hex#RGB';
  if (c.startsWith('oklch(')) return 'oklch(...)';
  if (c.startsWith('var(--')) return 'var(--chip-*)';
  if (c.startsWith('rgb('))   return 'rgb(...)';
  if (c.startsWith('hsl('))   return 'hsl(...)';
  return `OTHER (${c.slice(0, 24)})`;
}

async function main() {
  // 1) All distinct color strings + their count + classification
  const { data: rows } = await SB
    .from('column_labels')
    .select('id, name, color, sort_order, column_id, created_at')
    .order('created_at', { ascending: false })
    .limit(500);
  const all = (rows ?? []) as Array<{ id: string; name: string; color: string; column_id: string; created_at: string }>;
  console.log(`Pulled ${all.length} most-recent column_labels rows.\n`);

  // Tally format buckets
  const buckets = new Map<string, { count: number; samples: { color: string; name: string; created: string }[] }>();
  for (const r of all) {
    const fmt = classify(r.color);
    const b = buckets.get(fmt) ?? { count: 0, samples: [] };
    b.count += 1;
    if (b.samples.length < 3) b.samples.push({ color: r.color, name: r.name, created: r.created_at });
    buckets.set(fmt, b);
  }
  console.log('--- Format frequency across the whole column_labels table ---');
  for (const [fmt, b] of [...buckets.entries()].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${fmt.padEnd(20)} ${String(b.count).padStart(4)} rows`);
    for (const s of b.samples) console.log(`      e.g.  color="${s.color}"  name="${s.name}"  created=${s.created}`);
  }

  // 2) Zoom into "QA Test" board (where the user observed the bug) to
  //    show the exact colors on its labels, alongside column type.
  console.log('\n--- "QA Test" board labels (board id 25d1a287-…) ---');
  const QA = '25d1a287-6634-4ab5-92da-386bac80aca6';
  const { data: cols } = await SB
    .from('columns')
    .select('id, name, column_type, archived_at')
    .eq('board_id', QA);
  const colMap = new Map<string, { name: string; type: string; archived: boolean }>();
  for (const c of (cols ?? []) as Array<{ id: string; name: string; column_type: string; archived_at: string | null }>) {
    colMap.set(c.id, { name: c.name, type: c.column_type, archived: !!c.archived_at });
  }
  const { data: qaLabels } = await SB
    .from('column_labels')
    .select('id, name, color, sort_order, column_id, created_at')
    .in('column_id', [...colMap.keys()])
    .order('column_id')
    .order('sort_order');
  for (const l of (qaLabels ?? []) as Array<{ id: string; name: string; color: string; sort_order: number; column_id: string; created_at: string }>) {
    const c = colMap.get(l.column_id)!;
    const flag = c.archived ? '[ARCHIVED] ' : '';
    console.log(`  ${flag}${c.name.padEnd(14)} (${c.type.padEnd(8)})  sort=${l.sort_order}  ${classify(l.color).padEnd(20)}  color="${l.color}"  name="${l.name}"`);
  }

  // 3) Find the "Leave" label specifically (added in the previous
  //    session via add_column_label with explicit color "#55A8A8")
  console.log('\n--- "Leave" label as currently stored ---');
  const { data: leave } = await SB
    .from('column_labels')
    .select('id, name, color, column_id, created_at')
    .eq('name', 'Leave')
    .maybeSingle();
  console.log(`  ${JSON.stringify(leave, null, 2)}`);
}
main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
