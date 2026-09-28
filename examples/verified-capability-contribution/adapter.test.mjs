import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { extractCards } from './adapter.mjs';
const extract = (name) => extractCards({ html: fs.readFileSync(new URL(name, import.meta.url), 'utf8'), url: 'https://example.test/' });
test('new synthetic cards expose the complete title and link', () => {
  assert.deepEqual(extract('./new.html').records, [{ title: 'Synthetic card', url: 'https://example.test/records/1' }]);
});
test('ordinary links remain supported', () => {
  assert.deepEqual(extract('./old.html').records, [{ title: 'Synthetic old link', url: 'https://example.test/records/old' }]);
});
test('empty input emits a diagnostic', () => {
  assert.deepEqual(extract('./empty.html'), { records: [], diagnostics: [{ code: 'ZERO_RECORDS' }] });
});
