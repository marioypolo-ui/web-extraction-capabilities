import assert from 'node:assert/strict';
import test from 'node:test';

import { extract } from '../src/index.mjs';

test('browser capability reports a missing mature driver explicitly', async () => {
  const result = await extract({
    capabilityId: 'browser-click',
    url: 'https://example.test/app',
    config: { click: { text: 'All notices' } },
    browserModule: '__module_that_does_not_exist__'
  });

  assert.deepEqual(result.records, []);
  assert.ok(result.diagnostics.some((item) => item.code === 'CAPABILITY_DEPENDENCY_MISSING'));
});

test('authenticated browser capability refuses to own application credentials', async () => {
  const result = await extract({
    capabilityId: 'authenticated-session',
    url: 'https://example.test/private'
  });

  assert.ok(result.diagnostics.some((item) => item.code === 'AUTH_SESSION_REQUIRED'));
  assert.equal(JSON.stringify(result).includes('password'), false);
});
