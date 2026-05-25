/**
 * Unit verifier for unwrapCellValue + the per-type readers.
 *
 * Runs entirely in-process — no DB, no network. Proves the helper
 * handles every shape we've seen in the wild without breaking any
 * canonical shape the UI writes back.
 */
import {
  unwrapCellValue,
  readDateValue,
  readTextValue,
  readNumberValue,
  readCheckboxValue,
  readLinkValue,
} from '../src/components/board/table/cells/cellValue.js';

let failures = 0;
const eq = (got: unknown, want: unknown, label: string) => {
  const gotS = JSON.stringify(got), wantS = JSON.stringify(want);
  if (gotS === wantS) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ ${label}\n      got:  ${gotS}\n      want: ${wantS}`);
  }
};

console.log('\nunwrapCellValue passes flat shapes through unchanged');
eq(unwrapCellValue({ date: '2026-05-26' }),      { date: '2026-05-26' },      'canonical date');
eq(unwrapCellValue({ text: '10:00 AM' }),         { text: '10:00 AM' },         'canonical text');
eq(unwrapCellValue({ value: 42 }),                { value: 42 },                'canonical number (value:number stays)');
eq(unwrapCellValue({ label_id: 'abc' }),          { label_id: 'abc' },          'canonical status');
eq(unwrapCellValue({ url: 'https://x', text: 'X' }), { url: 'https://x', text: 'X' }, 'canonical link');
eq(unwrapCellValue({ checked: true }),            { checked: true },            'canonical checkbox');
eq(unwrapCellValue(null),                          null,                         'null');
eq(unwrapCellValue(undefined),                     undefined,                    'undefined');

console.log('\nunwrapCellValue peels the MCP envelope (value: JSON-string)');
eq(unwrapCellValue({ value: '{"date":"2026-05-26"}' }), { date: '2026-05-26' }, 'wrapped date');
eq(unwrapCellValue({ value: '{"text":"10:00 AM"}' }),    { text: '10:00 AM' },   'wrapped text');
eq(unwrapCellValue({ value: '{"value":42}' }),           { value: 42 },          'wrapped number');
eq(unwrapCellValue({ value: '{"url":"https://x"}' }),    { url: 'https://x' },   'wrapped link');

console.log('\nreadDateValue');
eq(readDateValue({ date: '2026-05-26' }),                          '2026-05-26', 'canonical');
eq(readDateValue({ value: '{"date":"2026-05-26"}' }),              '2026-05-26', 'MCP-wrapped (the actual bug shape)');
eq(readDateValue({ value: '{"date": "2026-05-26"}' }),             '2026-05-26', 'MCP-wrapped with spaces in JSON');
eq(readDateValue('2026-05-26'),                                     '2026-05-26', 'plain ISO string');
eq(readDateValue(null),                                              null,         'null');
eq(readDateValue({}),                                                null,         'empty object');

console.log('\nreadTextValue');
eq(readTextValue({ text: '10:00 - 10:20 AM' }),                     '10:00 - 10:20 AM', 'canonical');
eq(readTextValue({ value: '{"text":"10:00 - 10:20 AM"}' }),         '10:00 - 10:20 AM', 'MCP-wrapped (the actual bug shape)');
eq(readTextValue({ value: '{"text": "5:30 - 6:00 PM"}' }),          '5:30 - 6:00 PM',   'MCP-wrapped with spaces');
eq(readTextValue('just a string'),                                   'just a string',   'plain string');
eq(readTextValue(null),                                              '',                'null → empty');

console.log('\nreadNumberValue — must NOT unwrap canonical {value: <number>}');
eq(readNumberValue({ value: 42 }),                                   42,         'canonical');
eq(readNumberValue({ value: '{"value":42}' }),                       42,         'wrapped');
eq(readNumberValue({ value: '42' }),                                 42,         'string number coerced');
eq(readNumberValue(null),                                            null,        'null');
eq(readNumberValue({}),                                              null,        'empty');

console.log('\nreadCheckboxValue');
eq(readCheckboxValue({ checked: true }),                              true,        'canonical');
eq(readCheckboxValue({ checked: false }),                             false,       'canonical false');
eq(readCheckboxValue({ value: '{"checked":true}' }),                  true,        'wrapped');
eq(readCheckboxValue(null),                                           false,       'null → false');

console.log('\nreadLinkValue');
eq(readLinkValue({ url: 'https://x', text: 'X' }),                    { url: 'https://x', text: 'X' }, 'canonical');
eq(readLinkValue({ value: '{"url":"https://x","text":"X"}' }),        { url: 'https://x', text: 'X' }, 'wrapped');
eq(readLinkValue(null),                                                { url: '', text: '' },          'null');

if (failures > 0) {
  console.error(`\n❌ ${failures} check(s) failed`);
  process.exit(1);
}
console.log(`\n✅ All unwrap checks passed.`);
