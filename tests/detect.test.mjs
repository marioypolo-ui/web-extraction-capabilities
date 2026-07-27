import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import { detectCapabilities } from '../src/index.mjs';

const fixture = (name) => fs.readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

test('detect recommends static HTML extraction for a populated list', async () => {
  const detected = await detectCapabilities({
    url: 'https://example.test/notices',
    html: await fixture('static-list.html')
  });

  assert.equal(detected.recommendations[0].capabilityId, 'static-html-list');
  assert.equal(detected.diagnostics.length, 0);
});

test('detect reports slider verification as human required', async () => {
  const detected = await detectCapabilities({
    url: 'https://example.test/notices',
    html: await fixture('challenge.html')
  });

  assert.ok(detected.recommendations.some((item) => item.capabilityId === 'human-verification'));
  assert.ok(detected.diagnostics.some((item) => item.code === 'HUMAN_VERIFICATION_REQUIRED'));
});

test('detect identifies an unrendered SPA shell without claiming records exist', async () => {
  const detected = await detectCapabilities({
    url: 'https://example.test/app',
    html: await fixture('spa-shell.html')
  });

  assert.ok(detected.recommendations.some((item) => item.capabilityId === 'spa-api'));
  assert.ok(detected.diagnostics.some((item) => item.code === 'DYNAMIC_RENDERING_REQUIRED'));
});
