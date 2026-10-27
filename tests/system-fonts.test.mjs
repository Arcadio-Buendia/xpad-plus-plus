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
