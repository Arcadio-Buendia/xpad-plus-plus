import { test } from 'node:test';
import assert from 'node:assert/strict';
import fonts from '../system-fonts.js';

test('Fontconfig families and aliases are sorted and deduplicated', () => {
  assert.deepEqual(fonts.parseFontFamilies('JetBrains Mono,JetBrains Mono Light\nNoto Sans\nJetBrains Mono\n\n'),
    ['JetBrains Mono', 'JetBrains Mono Light', 'Noto Sans']);
});

test('empty Fontconfig output contains no selectable fonts', () => {
  assert.deepEqual(fonts.parseFontFamilies('\n  \n'), []);
});

test('font listing remains usable when Fontconfig is missing', async () => {
  const result = await fonts.listSystemFonts(async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); });
  assert.equal(result.ok, true);
  assert.deepEqual(result.families, []);
  assert.match(result.warning, /Kalam/);
});

test('font listing returns discovered system fonts when available', async () => {
  const result = await fonts.listSystemFonts(async () => ({ stdout: 'Noto Sans\nKalam\nNoto Sans\n' }));
  assert.deepEqual(result, { ok: true, families: ['Kalam', 'Noto Sans'] });
});
