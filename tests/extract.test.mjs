import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import { extract } from '../src/index.mjs';

const fixture = (name) => fs.readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

test('static HTML extraction returns normalized records', async () => {
  const result = await extract({
    capabilityId: 'static-html-list',
    url: 'https://example.test/notices/',
    html: await fixture('static-list.html')
  });

  assert.equal(result.capabilityId, 'static-html-list');
  assert.equal(result.capabilityVersion, '0.1.2');
  assert.equal(result.records.length, 2);
  assert.deepEqual(result.records[0], {
    title: 'Alpha procurement notice',
    url: 'https://example.test/notices/alpha',
    publishedAt: '2026-07-20',
    summary: 'Short public summary.',
    raw: {}
  });
});

test('zero records is a diagnosed result rather than silent success', async () => {
  const result = await extract({
    capabilityId: 'static-html-list',
    url: 'https://example.test/empty',
    html: '<html><body><p>No notices here.</p></body></html>'
  });

  assert.deepEqual(result.records, []);
  assert.ok(result.diagnostics.some((item) => item.code === 'ZERO_RECORDS'));
});

test('javascript and onclick links produce an actionable diagnostic', async () => {
  const result = await extract({
    capabilityId: 'static-html-list',
    url: 'https://example.test/notices',
    html: await fixture('action-links.html')
  });

  assert.ok(result.diagnostics.some((item) => item.code === 'ACTION_LINK_REQUIRES_CONFIGURATION'));
});

test('configured data-id action links become ordinary record URLs', async () => {
  const result = await extract({
    capabilityId: 'action-link-resolution',
    url: 'https://example.test/notices',
    html: await fixture('action-links.html'),
    config: { actionUrlTemplate: '/notices/{id}' }
  });

  assert.equal(result.records[0].title, 'Action-only notice');
  assert.equal(result.records[0].url, 'https://example.test/notices/notice-42');
  assert.deepEqual(result.diagnostics, []);
});

test('JSON API extraction maps configured fields into normalized records', async () => {
  const result = await extract({
    capabilityId: 'json-api-list',
    url: 'https://example.test/api/notices',
    json: JSON.parse(await fixture('json-api.json')),
    config: {
      itemsPath: 'data.items',
      fields: {
        title: 'name',
        url: 'link',
        publishedAt: 'date',
        summary: 'description'
      }
    }
  });

  assert.equal(result.records[0].title, 'API supplied notice');
  assert.equal(result.records[0].url, 'https://example.test/notices/api-1');
});

test('migrated platform families are available through the unified result contract', async () => {
  const result = await extract({
    capabilityId: 'tender-platform-families',
    url: 'https://example.edu.cn/notices/',
    html: await fixture('list.html')
  });

  assert.equal(result.capabilityId, 'tender-platform-families');
  assert.equal(result.records.length, 3);
  assert.equal(result.records[0].publishedAt, '2026-05-14');
  assert.deepEqual(result.diagnostics, []);
});

test('auto extraction prefers a reusable verified website capability', async () => {
  const result = await extract({
    capabilityId: 'auto',
    url: 'https://www.gxufe.edu.cn/www/myweb/level.html?typeid=www010e&typeid0=www01',
    html: await fixture('list.html')
  });

  assert.equal(result.capabilityId, 'tender-platform-families');
  assert.equal(result.records.length, 3);
});

test('reported website references do not silently control auto routing', async () => {
  const result = await extract({
    capabilityId: 'auto',
    url: 'https://www.gxzyy.com.cn/public_cggg/',
    html: await fixture('static-list.html')
  });

  assert.equal(result.capabilityId, 'static-html-list');
  assert.equal(result.records.length, 2);
});
