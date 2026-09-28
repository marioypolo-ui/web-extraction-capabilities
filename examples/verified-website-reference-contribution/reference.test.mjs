import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
test('synthetic reference contains the expected public link', () => {
  const html = fs.readFileSync(new URL('./fixture.html', import.meta.url), 'utf8');
  assert.match(html, /href="\/notices\/1"/);
  assert.match(html, /Synthetic public notice/);
});
