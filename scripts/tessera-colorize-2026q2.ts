/**
 * One-off colorize of all 90 Tessera tasks across the 3 new position
 * groups (Marketing & E-Com, Stock Market, Real Estate). Writes
 * Status / Task Type / Co-Work Time / Priority cells via the existing
 * item_column_values table — same shape my prior introspection found:
 *
 *   { item_id uuid, column_id uuid, value jsonb {"label_id": "<uuid>"} }
 *   UNIQUE (item_id, column_id)
 *
 * UPSERT keyed on (item_id, column_id) — idempotent, safe to re-run.
 * The 22-or-so cells already populated on the first 6 Marketing &
 * E-Com tasks are left alone unless a conflicting entry appears here
 * (none does for the 5 fully-filled tasks; 2e5c6064 gets its 2
 * missing cells added explicitly).
 *
 * Wrapped in a single transaction — rollback on any failure. Post-
 * verify confirms exactly 360 cells across the 4 columns × 90 tasks.
 */
import './loadEnv';
import { Client } from 'pg';

// ---- column ids (locked) -----------------------------------------------
const COL = {
  status:   '4c6c4dd5-5fee-4652-95cb-93971a6fc4fa',
  type:     '0024eda6-7cc0-4011-866f-a653de6c42a1',
  cowork:   '245afa1f-5784-4d68-a4cd-1fb717fc9a3e',
  priority: '607509c9-8047-459f-b1e0-0adc23e02b9d',
};

// ---- label-name → uuid maps (locked) -----------------------------------
const STATUS_LBL: Record<string, string> = {
  'Working on it': '9027e710-29ad-4b19-a2a4-fe74482105e3',
  'Not Started':   'ee5a619b-b31a-4e89-87b5-ef989d5174b0',
  'Done':          '37ef515f-e0f4-4085-b92d-3d9944845bae',
  'Stuck':         '3b241bd7-553d-4f46-b9d0-48040b1ec866',
  'Need Help':     '911b2e9a-073d-43de-b171-9d978b735fa7',
  'Daily Task':    '4875e911-3d57-45e5-bbd9-b7c647899c60',
};

const TYPE_LBL: Record<string, string> = {
  'Human & Co-Work':           '326c60de-8416-4c98-aad2-e340d357404b',
  'Task Requires AI Co-Work':  '4134a6ff-49a3-4f59-8e81-9ebaa383e227',
  'By Human':                  '7d8b855c-99cb-4e7b-9ed0-d707fa3ee084',
  'Task by Mark Only':         '80f1e7eb-38f8-43f4-ada1-011e72cea78c',
};

const COWORK_LBL: Record<string, string> = {
  '5 - 10 minutes':  '7d279ce2-fd26-43d2-8fc1-209ca589e042',
  '30-45 minutes':   'acb76fcc-49d2-4db3-80d3-871aeb710910',
  '60-90 Minutes':   'cc21e6e9-5f21-4ade-81c0-2413592a0748',
  '75-100 Minutes':  '170b1f87-0da8-4d02-b872-f0202b9ea563',
  '1-2 Hours':       '5fcf4b91-b5ba-4579-af31-0e21a072162e',
  '2 - 2.5 hours':   '2768c0da-7c51-4746-a29b-3657e855a85a',
  '2-3 Hours':       'ceb6e62c-bf02-4362-bb0c-121a2a31638c',
};

const PRIORITY_LBL: Record<string, string> = {
  'Low':                '6459c957-34e0-4232-844a-3eef0f30e1b5',
  'Medium':             '212bcca6-71ba-4b33-a772-8121e881ff75',
  'High':               'a1840d83-80b8-4801-a349-93e698e1648d',
  'Very Important':     '69ce2509-1f09-45bc-9b6b-35b2f6800099',
  'Critical':           'd84d0bd4-eaa9-4533-9f80-2c20abe116ce',
  'Top Urgent':         '20c026ee-5f56-41c4-92f5-933050b33a9d',
  'Highest Priority':   'c1db6cad-59ee-43c0-8b8b-5a28c65ace03',
};

// ---- The 6 already-filled tasks (skip writing their 4-cell quads) ------
// 2e5c6064 has only 2 of 4 — we top it up below explicitly.
const PREFILLED_FULL = new Set<string>([
  '7ef5f667-b994-4ad9-bfda-3a157d178ea8',
  'b28a9c53-4510-41e9-87f4-ea1a3a25ecdc',
  '1a5bde87-6025-4283-bab7-653f3d23cfe1',
  '80746de6-195f-4fc5-98d4-545e7fa8b6e7',
  '31fd63d3-cc95-46e8-9c20-4193d103144b',
]);

// ---- Per-task assignments. Each row: [task_id, status, type, cowork, priority] ----
// Marketing & E-Com remaining (24)
const MARKETING: [string, string, string, string, string][] = [
  ['f3fbff5b-6da8-4008-b677-703cf16198a9', 'Not Started',   'Task Requires AI Co-Work', '60-90 Minutes', 'High'],
  ['d24e98b2-de27-48fd-9d0b-a55408ba1224', 'Working on it', 'Task Requires AI Co-Work', '30-45 minutes', 'Medium'],
  ['6eec403f-0e01-473a-8649-64d0e552814f', 'Not Started',   'Human & Co-Work',          '60-90 Minutes', 'Critical'],
  ['b93afcaa-205f-45c5-9d97-6db9e1960a01', 'Not Started',   'Human & Co-Work',          '2-3 Hours',     'Critical'],
  ['2ba52de2-24bf-43e6-a7e8-21c59a1007d4', 'Not Started',   'Task Requires AI Co-Work', '1-2 Hours',     'High'],
  ['48087a21-1a15-4c79-8abe-2996c925afd9', 'Not Started',   'Task Requires AI Co-Work', '60-90 Minutes', 'Very Important'],
  ['dcde6add-f156-4d28-ad0f-9fd8646502af', 'Working on it', 'Human & Co-Work',          '2-3 Hours',     'Top Urgent'],
  ['0f4cfa20-b97f-4fdf-bc6a-78efc1eee131', 'Not Started',   'Human & Co-Work',          '60-90 Minutes', 'Highest Priority'],
  ['771a5654-df23-4834-8cf4-22ee97a08592', 'Daily Task',    'Task Requires AI Co-Work', '30-45 minutes', 'Highest Priority'],
  ['bda8f2e5-8be3-425e-918e-f39d7c0f4d82', 'Not Started',   'Human & Co-Work',          '30-45 minutes', 'Highest Priority'],
  ['ac3e8ba1-0032-4f04-8282-d01407b98b6a', 'Not Started',   'Task Requires AI Co-Work', '60-90 Minutes', 'High'],
  ['2ad304f7-cf80-4ffc-b359-d71269cf29cc', 'Working on it', 'Task Requires AI Co-Work', '1-2 Hours',     'High'],
  ['a6b673e1-80d7-4e53-a973-3c5e98211f11', 'Working on it', 'Task Requires AI Co-Work', '60-90 Minutes', 'Medium'],
  ['c06102f4-0ea1-4bcb-b3e9-13083f6a6d24', 'Not Started',   'Human & Co-Work',          '2-3 Hours',     'Medium'],
  ['b7c1e5ed-3818-4d6f-bbe8-9b08a6b80511', 'Not Started',   'Task Requires AI Co-Work', '1-2 Hours',     'Medium'],
  ['a10e9c0a-763b-46d8-b698-2de444f93966', 'Daily Task',    'Task Requires AI Co-Work', '5 - 10 minutes', 'Very Important'],
  ['df93222f-8149-4458-8bc9-9c89a539dc7f', 'Not Started',   'Human & Co-Work',          '2-3 Hours',     'High'],
  ['7c4925c8-0992-4c7f-91b1-38276441a081', 'Daily Task',    'Task Requires AI Co-Work', '30-45 minutes', 'Highest Priority'],
  ['d1db9845-6dc0-4d1e-b231-8dc9ba6b0113', 'Not Started',   'Task Requires AI Co-Work', '60-90 Minutes', 'Medium'],
  ['ece6e0d2-d02e-40bf-b6e1-67d7214c336b', 'Not Started',   'Human & Co-Work',          '2-3 Hours',     'High'],
  ['cf5b17b2-b4a4-4395-8f1e-b6e34d753ceb', 'Not Started',   'Task Requires AI Co-Work', '60-90 Minutes', 'High'],
  ['340dc262-43c8-4785-9296-d5e4c82f40a6', 'Not Started',   'Human & Co-Work',          '60-90 Minutes', 'Medium'],
  ['327d9b57-144d-4065-ba78-57908cc4f609', 'Not Started',   'Task Requires AI Co-Work', '60-90 Minutes', 'Critical'],
  ['779e855e-ac1d-432e-94df-b7ba227a8287', 'Not Started',   'Human & Co-Work',          '2-3 Hours',     'High'],
];

// Stock Market (30)
const STOCK: [string, string, string, string, string][] = [
  ['1492c147-b625-4f58-965c-62afa2ff6daa', 'Daily Task',    'Task Requires AI Co-Work', '5 - 10 minutes', 'Highest Priority'],
  ['b2ae3b43-4060-4e2b-9ec3-73d8b4d930e8', 'Not Started',   'Task Requires AI Co-Work', '30-45 minutes',  'Highest Priority'],
  ['4c0c926d-7c6c-441c-8273-9930aa4cf361', 'Working on it', 'Human & Co-Work',          '30-45 minutes',  'Critical'],
  ['aaa1c4b5-add9-4724-9507-ac78ea23ba64', 'Not Started',   'Human & Co-Work',          '60-90 Minutes',  'Critical'],
  ['7f38c527-376e-4e3f-9556-adfd2dfd04ae', 'Not Started',   'Human & Co-Work',          '60-90 Minutes',  'High'],
  ['7e1ec53c-4a3e-4da3-9ddc-54485aa14d24', 'Daily Task',    'Task Requires AI Co-Work', '30-45 minutes',  'Highest Priority'],
  ['0f45072d-fff5-4d27-b269-8fa813dfbe03', 'Daily Task',    'Task Requires AI Co-Work', '30-45 minutes',  'Highest Priority'],
  ['44688846-a744-47b9-800c-03f193c0fcb7', 'Daily Task',    'Task Requires AI Co-Work', '30-45 minutes',  'Very Important'],
  ['9d696159-f4dc-4b4c-afa0-92ce5c4a8c36', 'Daily Task',    'Human & Co-Work',          '30-45 minutes',  'Very Important'],
  ['2305fd87-f078-4eda-8a73-7abb3c0bab6e', 'Daily Task',    'Human & Co-Work',          '30-45 minutes',  'High'],
  ['ffc70c24-4bb2-487e-9243-2e359b41c965', 'Not Started',   'Task Requires AI Co-Work', '60-90 Minutes',  'High'],
  ['cd717e57-527f-4885-b8f1-0ba539178a0b', 'Daily Task',    'Task Requires AI Co-Work', '5 - 10 minutes', 'Critical'],
  ['c7b9fc6a-a680-45b0-8155-77542a3b032b', 'Not Started',   'Human & Co-Work',          '5 - 10 minutes', 'Critical'],
  ['b322c092-52ef-449e-85c9-e82841c02ed6', 'Not Started',   'Human & Co-Work',          '5 - 10 minutes', 'Critical'],
  ['194ee300-79a5-4c55-ab5b-d9b2f967df2e', 'Not Started',   'Task Requires AI Co-Work', '2-3 Hours',      'Very Important'],
  ['45dd92d7-ef81-4c28-bc2a-f63d3a1a197b', 'Daily Task',    'Task Requires AI Co-Work', '30-45 minutes',  'High'],
  ['5cf9a738-cdc3-481f-8eac-89ec8680306a', 'Not Started',   'Task Requires AI Co-Work', '60-90 Minutes',  'High'],
  ['db71fb0a-42dd-4eea-b4ae-1da960b281eb', 'Not Started',   'Task Requires AI Co-Work', '30-45 minutes',  'Medium'],
  ['56fff143-5074-42be-8479-083784148500', 'Not Started',   'Task Requires AI Co-Work', '30-45 minutes',  'Medium'],
  ['cf746ac9-b438-446b-b0d2-8229e176b152', 'Not Started',   'Task Requires AI Co-Work', '60-90 Minutes',  'High'],
  ['3fdc3791-2434-4079-baa0-0e169e3e586c', 'Not Started',   'Task Requires AI Co-Work', '2-3 Hours',      'Medium'],
  ['4fad7398-2948-4074-8f77-539779cfa943', 'Not Started',   'Human & Co-Work',          '30-45 minutes',  'Very Important'],
  ['05427f89-1596-4411-a669-ff94647b1056', 'Not Started',   'Human & Co-Work',          '30-45 minutes',  'Highest Priority'],
  ['fad06226-b92d-4fd6-9a4b-30b6990075fb', 'Daily Task',    'Human & Co-Work',          '5 - 10 minutes', 'Medium'],
  ['70812a3a-ad5e-45ac-94f6-36639872ab4d', 'Not Started',   'Task Requires AI Co-Work', '30-45 minutes',  'High'],
  ['94a353d1-ca2f-4c6b-80a7-ccb7143850d7', 'Working on it', 'Human & Co-Work',          '30-45 minutes',  'Highest Priority'],
  ['2efbcdf6-2823-42a6-8f98-80cc938b6c31', 'Not Started',   'Task Requires AI Co-Work', '30-45 minutes',  'Medium'],
  ['2fe23f08-1de1-4740-b532-4a85f1d00b1d', 'Daily Task',    'Task Requires AI Co-Work', '5 - 10 minutes', 'High'],
  ['b93a673e-bceb-4e0b-8a85-ed690a47da4d', 'Not Started',   'Task Requires AI Co-Work', '60-90 Minutes',  'Very Important'],
  ['fcf22d2f-3257-4632-a83e-5f485cb57230', 'Not Started',   'Task Requires AI Co-Work', '1-2 Hours',      'Very Important'],
];

// Real Estate (30)
const REAL_ESTATE: [string, string, string, string, string][] = [
  ['3e0598cb-601e-45c5-b15a-5868a5aea9f7', 'Daily Task',    'Task Requires AI Co-Work', '5 - 10 minutes', 'Highest Priority'],
  ['e3150c6a-80c0-41e5-83fc-11914e48d4d2', 'Not Started',   'Task Requires AI Co-Work', '30-45 minutes',  'Highest Priority'],
  ['e351056f-b833-435c-8413-08f6223e17ad', 'Working on it', 'Human & Co-Work',          '30-45 minutes',  'Critical'],
  ['70e19300-b52e-4344-bef0-dc7f8474d1b7', 'Not Started',   'Human & Co-Work',          '60-90 Minutes',  'Critical'],
  ['d63c43f9-f6ff-4b4d-a005-c3fd13ea3072', 'Not Started',   'Human & Co-Work',          '1-2 Hours',      'Critical'],
  ['f396329e-8af0-45ce-ae9d-c2e15d3ad8c7', 'Not Started',   'Task Requires AI Co-Work', '30-45 minutes',  'Very Important'],
  ['d9883a3f-1972-4183-9d5b-79e8038cf6bd', 'Not Started',   'Human & Co-Work',          '60-90 Minutes',  'Highest Priority'],
  ['b4eaeaff-8ebe-43fc-ad91-9352ed427b99', 'Not Started',   'Human & Co-Work',          '60-90 Minutes',  'Highest Priority'],
  ['3f2eb8d5-8072-4649-8651-266ae8bdb762', 'Not Started',   'Human & Co-Work',          '2-3 Hours',      'Critical'],
  ['ddfe9b6d-5e88-48fb-8f5b-fec9e1aa8264', 'Not Started',   'Human & Co-Work',          '2-3 Hours',      'High'],
  ['7a2c87e8-04cf-4746-8fa2-1d893ea111d3', 'Working on it', 'Task Requires AI Co-Work', '1-2 Hours',      'High'],
  ['e800645a-d789-4bd8-9a32-f7d21da47d2d', 'Not Started',   'Task Requires AI Co-Work', '60-90 Minutes',  'High'],
  ['654dfb7d-4429-4340-97a4-7a0cd48b9508', 'Not Started',   'Task Requires AI Co-Work', '60-90 Minutes',  'Highest Priority'],
  ['832dbf2d-33de-4205-9c79-97781a76fa84', 'Daily Task',    'Task Requires AI Co-Work', '30-45 minutes',  'Highest Priority'],
  ['760371a4-01e4-46d6-84d2-7bb7d142028e', 'Daily Task',    'Human & Co-Work',          '60-90 Minutes',  'Highest Priority'],
  ['65a98658-bc85-4d33-a788-c237de76009b', 'Working on it', 'Task Requires AI Co-Work', '30-45 minutes',  'High'],
  ['2b7c4bb4-681e-4ddc-a944-68f319c9814c', 'Daily Task',    'Task Requires AI Co-Work', '30-45 minutes',  'Very Important'],
  ['f76ac798-e8cb-414a-9289-7957901823ef', 'Daily Task',    'Task Requires AI Co-Work', '30-45 minutes',  'Highest Priority'],
  ['bfcccc38-6d56-443b-a11d-d7d604fa3d35', 'Not Started',   'Task Requires AI Co-Work', '60-90 Minutes',  'High'],
  ['1cf23810-008b-4f3d-ba70-81c696526741', 'Not Started',   'Task Requires AI Co-Work', '30-45 minutes',  'Medium'],
  ['fffb69ac-d0d7-4007-8b08-602f6e247ca4', 'Not Started',   'Task Requires AI Co-Work', '60-90 Minutes',  'High'],
  ['cb71c197-578b-4f15-b100-9115dd903174', 'Not Started',   'Task Requires AI Co-Work', '30-45 minutes',  'High'],
  ['f6fdf5b7-4e32-4506-9c89-7abbd6f2396c', 'Not Started',   'Human & Co-Work',          '60-90 Minutes',  'Very Important'],
  ['95487d30-eb2b-4721-b6c2-6319b9e577ee', 'Not Started',   'Human & Co-Work',          '2-3 Hours',      'High'],
  ['0a0903f7-d102-43e7-9ab3-103dae8e4c5a', 'Working on it', 'Human & Co-Work',          '2-3 Hours',      'Highest Priority'],
  ['bdae3e24-5dd3-4041-9a86-8464c4c80b42', 'Not Started',   'Human & Co-Work',          '60-90 Minutes',  'Critical'],
  ['e7bf9803-0984-47fb-98ab-dc1fd3d24019', 'Not Started',   'Human & Co-Work',          '60-90 Minutes',  'High'],
  ['e48f5fe1-3f31-433a-93ac-ab14ecf2f67a', 'Daily Task',    'Task Requires AI Co-Work', '30-45 minutes',  'Critical'],
  ['88a64cf2-ac96-41de-9793-20c030568e26', 'Not Started',   'Task Requires AI Co-Work', '60-90 Minutes',  'High'],
  ['2d9c4736-0fa5-4c58-a26d-6ac6c9fbc0ed', 'Not Started',   'Task Requires AI Co-Work', '60-90 Minutes',  'Very Important'],
];

const FULL_TASKS_TO_WRITE: [string, string, string, string, string][] = [
  ...MARKETING, ...STOCK, ...REAL_ESTATE,
];

// 2e5c6064 needs ONLY Co-Work Time + Priority topped up.
const PARTIAL_TOPUP: { item_id: string; column_id: string; label_id: string }[] = [
  { item_id: '2e5c6064-8693-43d3-9cff-c49dba01f1a0', column_id: COL.cowork,   label_id: COWORK_LBL['60-90 Minutes'] },
  { item_id: '2e5c6064-8693-43d3-9cff-c49dba01f1a0', column_id: COL.priority, label_id: PRIORITY_LBL['Medium']      },
];

// All 90 tasks for the post-verify SELECT (5 fully-prefilled + 1 topped-up + 84 fully-written).
const ALL_90 = [
  ...Array.from(PREFILLED_FULL),
  '2e5c6064-8693-43d3-9cff-c49dba01f1a0',
  ...FULL_TASKS_TO_WRITE.map((r) => r[0]),
];

// ---- Build the triple list --------------------------------------------
interface Triple { item_id: string; column_id: string; label_id: string }
function buildTriples(): Triple[] {
  const out: Triple[] = [...PARTIAL_TOPUP];
  for (const [tid, st, ty, cw, pr] of FULL_TASKS_TO_WRITE) {
    const sLbl = STATUS_LBL[st];
    const tLbl = TYPE_LBL[ty];
    const cLbl = COWORK_LBL[cw];
    const pLbl = PRIORITY_LBL[pr];
    if (!sLbl) throw new Error('unknown Status label: ' + st);
    if (!tLbl) throw new Error('unknown Type label: '   + ty);
    if (!cLbl) throw new Error('unknown CoWork label: ' + cw);
    if (!pLbl) throw new Error('unknown Priority label: ' + pr);
    out.push({ item_id: tid, column_id: COL.status,   label_id: sLbl });
    out.push({ item_id: tid, column_id: COL.type,     label_id: tLbl });
    out.push({ item_id: tid, column_id: COL.cowork,   label_id: cLbl });
    out.push({ item_id: tid, column_id: COL.priority, label_id: pLbl });
  }
  return out;
}

async function main() {
  const triples = buildTriples();
  console.log('Writing ' + triples.length + ' cells (2 topup + 84 tasks × 4)');

  const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('begin');
    let writes = 0;
    for (const t of triples) {
      await c.query(
        `insert into public.item_column_values (item_id, column_id, value, updated_at)
         values ($1, $2, jsonb_build_object('label_id', $3::text), now())
         on conflict (item_id, column_id) do update set
           value      = jsonb_build_object('label_id', $3::text),
           updated_at = now()`,
        [t.item_id, t.column_id, t.label_id],
      );
      writes++;
    }
    await c.query('commit');
    console.log('committed ' + writes + ' upserts.\n');
  } catch (e) {
    await c.query('rollback');
    console.error('ROLLED BACK:', e);
    process.exit(1);
  }

  // ---- post-verify: 360 cells across 90 tasks × 4 columns ----
  const { rows: [r] } = await c.query<{ n: string }>(
    `select count(*) as n
       from public.item_column_values
      where item_id   = any($1::uuid[])
        and column_id = any($2::uuid[])`,
    [ALL_90, [COL.status, COL.type, COL.cowork, COL.priority]],
  );
  console.log('========== POST-VERIFICATION ==========');
  console.log('SELECT count(*) FROM item_column_values WHERE item_id IN (<90>) AND column_id IN (<4>)');
  console.log('  → ' + r.n + '   (expected 360)');

  // Bonus: missing-cell breakdown (should be empty).
  const { rows: missing } = await c.query<{ item_id: string; missing_col: string }>(
    `with want as (
       select i.id as item_id, c.column_id
         from unnest($1::uuid[]) as i(id)
         cross join unnest($2::uuid[]) as c(column_id)
     )
     select w.item_id, w.column_id as missing_col
       from want w
       left join public.item_column_values icv
              on icv.item_id = w.item_id and icv.column_id = w.column_id
      where icv.id is null
      order by w.item_id`,
    [ALL_90, [COL.status, COL.type, COL.cowork, COL.priority]],
  );
  if (missing.length === 0) {
    console.log('  no missing cells ✓');
  } else {
    console.log('  MISSING (' + missing.length + '):');
    for (const m of missing) console.log('    ' + m.item_id + '  col=' + m.missing_col);
  }
  await c.end();
}
main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
