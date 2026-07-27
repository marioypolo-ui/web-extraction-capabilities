import assert from 'node:assert/strict';
import test from 'node:test';

import { findCapabilitiesForUrl, getCatalog, validateCatalog } from '../src/index.mjs';

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

test('every capability declares structured verified website references', async () => {
  const catalog = await getCatalog();

  for (const capability of catalog) {
    assert.ok(Array.isArray(capability.verifiedTargets), capability.id);
    for (const target of capability.verifiedTargets) {
      assert.match(target.name, /\S/);
      assert.match(target.referenceUrl, /^https?:\/\//);
      assert.match(target.verifiedAt, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(['fixture-tested', 'live-tested', 'reported'].includes(target.verification));
      assert.match(target.match.host, /\S/);
      assert.ok(Array.isArray(target.evidence));
    }
  }
});

test('catalog can match a known website to its reusable capability', async () => {
  const matches = await findCapabilitiesForUrl(
    'https://www.gxufe.edu.cn/www/myweb/level.html?typeid=www010e&typeid0=www01'
  );

  assert.equal(matches[0].capabilityId, 'tender-platform-families');
  assert.equal(matches[0].target.name, '广西财经学院');
  assert.equal(matches[0].reusable, true);
  assert.deepEqual(await findCapabilitiesForUrl('https://unknown.example.test/notices'), []);
});
