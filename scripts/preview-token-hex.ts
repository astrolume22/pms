/**
 * One-off: dump the 8 chip-token hex values so we can eyeball that the
 * oklch → hex math gives sane results before the renderer change goes
 * live. Run: npx tsx scripts/preview-token-hex.ts
 */
import { TOKEN_HEX, toCanonicalHex } from '../api/_shared/color-normalize.js';

console.log('Chip-token hex values:');
for (const [k, hex] of Object.entries(TOKEN_HEX)) {
  console.log(`  ${k.padEnd(7)} ${hex}`);
}

console.log('\nNormalizer round-trips:');
const samples = [
  '#E2445C',                   // canonical hex (legacy)
  '#fdb',                      // short hex (lowercase)
  'oklch(0.72 0.15 70)',       // amber oklch
  'oklch(0.45 0.02 250)',      // slate oklch
  'var(--chip-mint)',          // CSS variable form
  'mint',                       // bare token
  'red',                        // CSS color name → alias
  'goldenrod',                  // unknown name → default
  '',                           // empty → default
  'not-a-color',                // garbage → default
];
for (const s of samples) {
  console.log(`  ${JSON.stringify(s).padEnd(28)} → ${toCanonicalHex(s)}`);
}
