import assert from 'node:assert/strict';
import test from 'node:test';

import { extractExampleCards } from './adapter.mjs';

test('example contribution extracts its synthetic card', () => {
  const [record] = extractExampleCards(
    '<div data-record><a href="/records/1">Synthetic contributed record</a></div>',
    'https://example.test/'
  );
  assert.equal(record.title, 'Synthetic contributed record');
  assert.equal(record.url, 'https://example.test/records/1');
});
