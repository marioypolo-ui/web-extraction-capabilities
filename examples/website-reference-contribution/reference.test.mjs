import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('website reference fixture contains an announcement link', () => {
  const html = fs.readFileSync(new URL('./fixture.html', import.meta.url), 'utf8');
  assert.match(html, /href="\/notices\/1"/);
});
