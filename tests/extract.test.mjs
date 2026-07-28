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
  assert.equal(result.capabilityVersion, '0.1.3');
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

test('action-only pagination and mobile controls do not produce record diagnostics', async () => {
  const result = await extract({
    capabilityId: 'static-html-list',
    url: 'https://example.test/notices',
    html: `
      <ul>
        <li><a href="javascript:void(0)" onclick="_vsb_multiscreen.setDevice('mobile')">&#x624B;&#x673A;&#x7248;</a></li>
        <li><a href="javascript:;" onclick="_simple_list_gotopage_fun(2)">&#x8DF3;&#x8F6C;</a></li>
      </ul>`
  });

  assert.equal(
    result.diagnostics.some((item) => item.code === 'ACTION_LINK_REQUIRES_CONFIGURATION'),
    false
  );
  assert.ok(result.diagnostics.some((item) => item.code === 'ZERO_RECORDS'));
});

test('normal Chinese pagination titles do not produce record diagnostics', async () => {
  const result = await extract({
    capabilityId: 'static-html-list',
    url: 'https://example.test/notices',
    html: `
      <ul>
        <li><a href="javascript:;">&#x9996;&#x9875;</a></li>
        <li><a href="javascript:;">&#x4e0a;&#x4e00;&#x9875;</a></li>
        <li><a href="javascript:;">&#x4e0b;&#x4e00;&#x9875;</a></li>
        <li><a href="javascript:;">&#x5c3e;&#x9875;</a></li>
        <li><a href="javascript:;">&#x672b;&#x9875;</a></li>
      </ul>`
  });

  assert.equal(
    result.diagnostics.some((item) => item.code === 'ACTION_LINK_REQUIRES_CONFIGURATION'),
    false
  );
  assert.ok(result.diagnostics.some((item) => item.code === 'ZERO_RECORDS'));
});

test('pagination handlers do not suppress non-navigation action titles', async () => {
  const result = await extract({
    capabilityId: 'static-html-list',
    url: 'https://example.test/notices',
    html: '<ul><li><a href="javascript:;" onclick="goPage(42)">Unknown but titled notice</a></li></ul>'
  });

  assert.ok(result.diagnostics.some((item) => item.code === 'ACTION_LINK_REQUIRES_CONFIGURATION'));
});

test('untitled action-only controls without record evidence do not produce diagnostics', async () => {
  const result = await extract({
    capabilityId: 'static-html-list',
    url: 'https://example.test/notices',
    html: '<ul><li><a href="#"></a></li></ul>'
  });

  assert.equal(
    result.diagnostics.some((item) => item.code === 'ACTION_LINK_REQUIRES_CONFIGURATION'),
    false
  );
  assert.ok(result.diagnostics.some((item) => item.code === 'ZERO_RECORDS'));
});

test('action-only placeholders in semantic and tokenized navigation containers are ignored', async () => {
  const cases = [
    '<nav><ul><li><a href="">International education</a></li></ul></nav>',
    '<ul class="nav-down"><li><a href="#" title="Admissions">Admissions</a></li></ul>'
  ];

  for (const html of cases) {
    const result = await extract({
      capabilityId: 'static-html-list',
      url: 'https://example.test/notices',
      html
    });
    assert.equal(
      result.diagnostics.some((item) => item.code === 'ACTION_LINK_REQUIRES_CONFIGURATION'),
      false,
      html
    );
  }
});

test('navigation-like tags inside HTML comments do not suppress content diagnostics', async () => {
  const result = await extract({
    capabilityId: 'static-html-list',
    url: 'https://example.test/notices',
    html: '<!-- <div class="nav-down"> --><ul class="news-list"><li><a href="#">Real notice</a></li></ul>'
  });

  assert.ok(result.diagnostics.some((item) => item.code === 'ACTION_LINK_REQUIRES_CONFIGURATION'));
});

test('unclosed comment markers in scripts do not hide later content diagnostics', async () => {
  const result = await extract({
    capabilityId: 'static-html-list',
    url: 'https://example.test/notices',
    html: '<script>const marker = "<!--";</script><ul class="news-list"><li><a href="#">Real notice</a></li></ul>'
  });

  assert.ok(result.diagnostics.some((item) => item.code === 'ACTION_LINK_REQUIRES_CONFIGURATION'));
});

test('comment markers in separate script raw-text blocks do not hide intervening content', async () => {
  const result = await extract({
    capabilityId: 'static-html-list',
    url: 'https://example.test/notices',
    html: `
      <script>const openingMarker = "<!--";</script>
      <ul class="news-list"><li><a href="#">Intervening notice</a></li></ul>
      <script>const closingMarker = "-->";</script>`
  });

  assert.ok(result.diagnostics.some((item) => item.code === 'ACTION_LINK_REQUIRES_CONFIGURATION'));
});

test('navigation tokens on block roots are ignored unless record evidence is present', async () => {
  const placeholder = await extract({
    capabilityId: 'static-html-list',
    url: 'https://example.test/notices',
    html: '<li class="nav-down"><a href="#">Admissions</a></li>'
  });
  const dated = await extract({
    capabilityId: 'static-html-list',
    url: 'https://example.test/notices',
    html: '<li class="nav-down"><time datetime="2026-07-28"></time><a href="#">Dated notice</a></li>'
  });

  assert.equal(
    placeholder.diagnostics.some((item) => item.code === 'ACTION_LINK_REQUIRES_CONFIGURATION'),
    false
  );
  assert.ok(dated.diagnostics.some((item) => item.code === 'ACTION_LINK_REQUIRES_CONFIGURATION'));
});

test('action-only titles in ordinary content lists remain diagnosed', async () => {
  const result = await extract({
    capabilityId: 'static-html-list',
    url: 'https://example.test/notices',
    html: '<ul class="news-list"><li><a href="#" title="Admissions">Admissions</a></li></ul>'
  });

  assert.ok(result.diagnostics.some((item) => item.code === 'ACTION_LINK_REQUIRES_CONFIGURATION'));
});

test('record evidence inside navigation containers remains diagnosed', async () => {
  const result = await extract({
    capabilityId: 'static-html-list',
    url: 'https://example.test/notices',
    html: '<nav><ul><li><time datetime="2026-07-28"></time><a href="#">Dated notice</a></li></ul></nav>'
  });

  assert.ok(result.diagnostics.some((item) => item.code === 'ACTION_LINK_REQUIRES_CONFIGURATION'));
});

test('javascript href content handlers remain diagnosed inside navigation contexts', async () => {
  const result = await extract({
    capabilityId: 'static-html-list',
    url: 'https://example.test/notices',
    html: '<nav><ul><li><a href="javascript:openNotice(42)">Open notice</a></li></ul></nav>'
  });

  assert.ok(result.diagnostics.some((item) => item.code === 'ACTION_LINK_REQUIRES_CONFIGURATION'));
});

test('block-root content handlers remain diagnosed inside navigation contexts', async () => {
  const result = await extract({
    capabilityId: 'static-html-list',
    url: 'https://example.test/notices',
    html: '<nav><ul><li onclick="openNotice(42)"><a href="#">Open notice</a></li></ul></nav>'
  });

  assert.ok(result.diagnostics.some((item) => item.code === 'ACTION_LINK_REQUIRES_CONFIGURATION'));
});

test('descendant data-id evidence remains diagnosed inside navigation contexts', async () => {
  const result = await extract({
    capabilityId: 'static-html-list',
    url: 'https://example.test/notices',
    html: '<nav><ul><li><a href="#"><span data-id="notice-42">Data notice</span></a></li></ul></nav>'
  });

  assert.ok(result.diagnostics.some((item) => item.code === 'ACTION_LINK_REQUIRES_CONFIGURATION'));
});

test('action-only blocks with record evidence remain diagnosed', async () => {
  const cases = [
    '<li><time datetime="2026-07-28"></time><a href="javascript:;" onclick="goPage(2)">Dated notice</a></li>',
    '<li><a href="javascript:;" data-id="notice-42">Data notice</a></li>',
    '<li><a href="javascript:;" onclick="openNotice(42)">Open notice</a></li>',
    '<li><a href="javascript:;" onclick="customAction()">Unknown but titled notice</a></li>'
  ];

  for (const html of cases) {
    const result = await extract({
      capabilityId: 'static-html-list',
      url: 'https://example.test/notices',
      html: `<ul>${html}</ul>`
    });
    assert.ok(
      result.diagnostics.some((item) => item.code === 'ACTION_LINK_REQUIRES_CONFIGURATION'),
      html
    );
  }
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
