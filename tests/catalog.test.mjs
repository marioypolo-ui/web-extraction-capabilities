import assert from 'node:assert/strict';
import test from 'node:test';

import { getCatalog, validateCatalog } from '../src/index.mjs';

test('catalog exposes at least ten distinct website capability classes', async () => {
  const catalog = await getCatalog();
  const ids = catalog.map((item) => item.id);

  assert.ok(catalog.length >= 10);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('static-html-list'));
  assert.ok(ids.includes('json-api-list'));
  assert.ok(ids.includes('browser-click'));
  assert.ok(ids.includes('human-verification'));
  assert.ok(ids.includes('fixed-dns-host'));
});

test('every catalog entry satisfies the public capability contract', async () => {
  const validation = await validateCatalog();

  assert.deepEqual(validation.errors, []);
  assert.ok(validation.capabilityCount >= 10);
});
