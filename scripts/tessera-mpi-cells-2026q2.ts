/**
 * One-off: populate the 4 cells (Status / Task Type / Co-Work Time /
 * Priority) for the 17 tasks in the brand-new "Marketing & Planning
 * Intelligence" group on Tessera.
 *
 * Why this script exists:
 *   The PMS MCP `bulk_create_tasks` call returned succeeded:17 BUT did
 *   not persist the per-task cells. The group now has 17 rows with the
 *   correct names + order, but every cell is empty. This script writes
 *   the 68 cells (17 × 4) the user specified, in one transaction.
 *
 * Convention: matches scripts/tessera-colorize-2026q2.ts — UPSERT
 * keyed on (item_id, column_id) so it's safe to re-run, single
 * transaction, post-verify confirms 68 cells.
 *
 * Touches ONLY the 17 task ids listed below. Nothing else.
 */
import './loadEnv';
import { Client } from 'pg';

const COL = {
  status:   '4c6c4dd5-5fee-4652-95cb-93971a6fc4fa',
  type:     '0024eda6-7cc0-4011-866f-a653de6c42a1',
  cowork:   '245afa1f-5784-4d68-a4cd-1fb717fc9a3e',
  priority: '607509c9-8047-459f-b1e0-0adc23e02b9d',
} as const;

// Status labels
const S_NOT_STARTED = 'ee5a619b-b31a-4e89-87b5-ef989d5174b0';
const S_DAILY_TASK  = '4875e911-3d57-45e5-bbd9-b7c647899c60';

// Task Type labels
const T_BY_HUMAN       = '7d8b855c-99cb-4e7b-9ed0-d707fa3ee084';
const T_HUMAN_COWORK   = '326c60de-8416-4c98-aad2-e340d357404b';
const T_AI_COWORK      = '4134a6ff-49a3-4f59-8e81-9ebaa383e227';

// Co-Work Time labels
const W_5_10  = '7d279ce2-fd26-43d2-8fc1-209ca589e042';
const W_30_45 = 'acb76fcc-49d2-4db3-80d3-871aeb710910';
const W_60_90 = 'cc21e6e9-5f21-4ade-81c0-2413592a0748';
const W_1_2H  = '5fcf4b91-b5ba-4579-af31-0e21a072162e';
const W_2_3H  = 'ceb6e62c-bf02-4362-bb0c-121a2a31638c';

// Priority labels
const P_HIGH     = 'a1840d83-80b8-4801-a349-93e698e1648d';
const P_HIGHEST  = 'c1db6cad-59ee-43c0-8b8b-5a28c65ace03';
const P_CRITICAL = 'd84d0bd4-eaa9-4533-9f80-2c20abe116ce';

// (task_id, status, type, cowork, priority) — exact order matches
// the user spec for the 3 PREP rows + 14 VA tasks.
const ROWS: Array<[string, string, string, string, string]> = [
  // PREP A
  ['30d394e3-2cfa-4db1-aefc-dfc4c9068f69', S_NOT_STARTED, T_BY_HUMAN,     W_1_2H,  P_CRITICAL],
  // PREP B
  ['32843a69-f1ae-4335-bdfb-859018836819', S_NOT_STARTED, T_BY_HUMAN,     W_30_45, P_CRITICAL],
  // PREP C
  ['d6c0de4a-8987-4acb-8581-e9f347887f35', S_NOT_STARTED, T_BY_HUMAN,     W_30_45, P_CRITICAL],
  // Clock In
  ['4b2e1ada-bece-41ff-a0af-6e113190b1dd', S_DAILY_TASK,  T_BY_HUMAN,     W_5_10,  P_HIGHEST],
  // Read the Mission
  ['e0af84af-6427-4019-9c5e-a1d0b9087636', S_NOT_STARTED, T_BY_HUMAN,     W_5_10,  P_HIGH],
  // Find Real Problems with Grok
  ['c9aa98a5-6912-4f51-a836-9f740845c0ec', S_NOT_STARTED, T_AI_COWORK,    W_60_90, P_HIGHEST],
  // Get 10 More Problems with Claude
  ['1083da76-191b-4e58-b475-e0bb04a652c8', S_NOT_STARTED, T_AI_COWORK,    W_30_45, P_HIGH],
  // Draft Helpful (but Incomplete) Answers
  ['8620521b-3006-48ea-83f7-04a98d221f07', S_NOT_STARTED, T_AI_COWORK,    W_60_90, P_HIGH],
  // Confirm the Language Decision
  ['39b06663-2cbe-4877-9849-1b0e68fd7a91', S_NOT_STARTED, T_BY_HUMAN,     W_5_10,  P_CRITICAL],
  // Sort Problems into Topics
  ['372de6fb-90e6-4ab1-ad2c-6feb217f654e', S_NOT_STARTED, T_AI_COWORK,    W_30_45, P_HIGH],
  // Build the AI Reading Report in Lovable — THE HEART
  ['42b4b83e-260f-42ee-a691-f80989c8c8a0', S_NOT_STARTED, T_HUMAN_COWORK, W_1_2H,  P_HIGHEST],
  // Build the Funnel Pages in Lovable
  ['6272c468-1bde-4313-b4ba-46cd01148cf8', S_NOT_STARTED, T_HUMAN_COWORK, W_2_3H,  P_HIGHEST],
  // Turn On the Small Fee (Stripe)
  ['0320edfe-701a-40a2-8830-5a790721540a', S_NOT_STARTED, T_HUMAN_COWORK, W_30_45, P_HIGHEST],
  // Soft Offer + Hand the Warm Client to the Boss
  ['8ca7173c-3a7a-4107-b978-e97b7e994e47', S_NOT_STARTED, T_HUMAN_COWORK, W_30_45, P_HIGHEST],
  // Study Competitor Ads (Apify to Claude)
  ['302b6c3a-0aef-410b-9d29-31b0016057c7', S_NOT_STARTED, T_AI_COWORK,    W_60_90, P_HIGH],
  // Launch the Ads at $5/day (Meta + TikTok)
  ['8520e410-c103-4feb-b31a-6f1ca1df2df3', S_NOT_STARTED, T_HUMAN_COWORK, W_1_2H,  P_HIGHEST],
  // Watch, Improve, and Clock Out
  ['918933e5-fd79-4703-8c45-72fbf9ff3f98', S_DAILY_TASK,  T_HUMAN_COWORK, W_30_45, P_HIGH],
];

const TASK_IDS = ROWS.map((r) => r[0]);
const COL_IDS  = [COL.status, COL.type, COL.cowork, COL.priority];

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();

  // Build the 68 (task_id, column_id, label_id) triples.
  const triples: Array<[string, string, string]> = [];
  for (const [tid, st, tp, wk, pr] of ROWS) {
    triples.push([tid, COL.status,   st]);
    triples.push([tid, COL.type,     tp]);
    triples.push([tid, COL.cowork,   wk]);
    triples.push([tid, COL.priority, pr]);
  }
  console.log('Writing ' + triples.length + ' cells (17 tasks × 4 columns)');

  try {
    await c.query('begin');
    for (const [item_id, column_id, label_id] of triples) {
      await c.query(
        `insert into public.item_column_values (item_id, column_id, value)
         values ($1, $2, jsonb_build_object('label_id', $3::text))
         on conflict (item_id, column_id)
         do update set value = excluded.value, updated_at = now()`,
        [item_id, column_id, label_id],
      );
    }
    await c.query('commit');
    console.log('committed ' + triples.length + ' upserts.');
  } catch (e) {
    await c.query('rollback');
    console.error('ROLLED BACK:', e);
    process.exit(1);
  }

  // ==================== POST-VERIFY ====================
  console.log('\n========== POST-VERIFICATION ==========\n');
  const { rows: [{ n }] } = await c.query<{ n: string }>(
    `select count(*) as n
       from public.item_column_values
      where item_id = any($1) and column_id = any($2)`,
    [TASK_IDS, COL_IDS],
  );
  console.log('SELECT count(*) FROM item_column_values WHERE item_id IN (<17 MPI ids>) AND column_id IN (<4 cols>)');
  console.log('  → ' + n + '   (expected 68)');

  // Missing-cell breakdown
  const have = new Set<string>();
  const { rows: cells } = await c.query<{ item_id: string; column_id: string }>(
    `select item_id, column_id
       from public.item_column_values
      where item_id = any($1) and column_id = any($2)`,
    [TASK_IDS, COL_IDS],
  );
  for (const r of cells) have.add(r.item_id + '|' + r.column_id);
  const missing: string[] = [];
  for (const tid of TASK_IDS) for (const cid of COL_IDS) {
    if (!have.has(tid + '|' + cid)) missing.push(tid + '|' + cid);
  }
  if (missing.length === 0) console.log('  no missing cells ✓');
  else {
    console.log('  MISSING CELLS (' + missing.length + '):');
    for (const m of missing) console.log('    ' + m);
    process.exit(1);
  }

  await c.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
