import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import * as library from '../src/index.mjs';

const article = '<article><h1>Example report</h1><p>A complete public report with useful information for readers.</p></article>';
const input = { url: 'https://example.test/reports/one', html: article };

test('detail API returns full content through a separate contract and preserves list extraction', async () => {
  assert.equal(typeof library.extractDetail, 'function');
  const result = await library.extractDetail(input);
  assert.equal(result.capabilityId, 'web-page-detail');
  assert.equal(result.capabilityVersion, library.LIBRARY_VERSION);
  assert.equal(result.document.title, 'Example report');
  assert.match(result.document.contentText, /complete public report/);
  assert.deepEqual(result.document.attachments, []);
  assert.equal('records' in result, false);
  const list = await library.extract({ capabilityId: 'static-html-list', url: input.url,
    html: '<ul><li><a href="/one">One</a></li></ul>' });
  assert.equal(list.records[0].title, 'One');
  assert.equal('document' in list, false);
});

test('detail HTML input stays offline even for a known dynamic platform', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('unexpected network access'); };
  try {
    const result = await library.extractDetail({ ...input, url: 'https://ctzc.nncytz.com/#/notice/detail/123' });
    assert.match(result.document.contentText, /complete public report/);
  } finally { globalThis.fetch = original; }
});

test('JSON detail maps an object and preserves plain text, images and attachments', async () => {
  const result = await library.extractDetail({ url: input.url, json: { data: {
    name: 'API detail', body: 'Amount < 100. Full detail\nSecond paragraph.', date: '2026-09-11',
    pictures: [{ url: '/img.png', alt: 'Chart' }], files: [{ url: '/file.pdf', title: 'Specification' }]
  } }, config: { mode: 'json', itemPath: 'data', fields: {
    title: 'name', content: 'body', publishedAt: 'date', images: 'pictures', attachments: 'files'
  } } });
  assert.equal(result.document.title, 'API detail');
  assert.equal(result.document.contentText, 'Amount < 100. Full detail\nSecond paragraph.');
  assert.equal(result.document.publishedAt, '2026-09-11');
  assert.equal(result.document.images[0].url, 'https://example.test/img.png');
  assert.equal(result.document.attachments[0].url, 'https://example.test/file.pdf');
});

test('JSON HTML detail extracts tables and never needs a list-shaped payload', async () => {
  const result = await library.extractDetail({ url: input.url, json: { body:
    '<p>Detailed specification</p><table><tr><th>Item</th></tr><tr><td>Service</td></tr></table>'
  }, config: { fields: { content: 'body' }, contentFormat: 'html' } });
  assert.match(result.document.contentText, /Detailed specification/);
  assert.equal(result.document.tables[0].rows[1][0].text, 'Service');
});

test('missing JSON content and invalid route configuration are explicit failures', async () => {
  for (const options of [
    { json: { body: 'Text' }, config: { mode: 'json' } },
    { json: { data: [] }, config: { itemPath: 'data', fields: { content: 'body' } } },
    { json: {}, config: { fields: { content: 'body' } } },
    { html: article, config: { mode: 'unknown' } },
    { html: article, url: 'javascript:alert(1)' }
  ]) {
    const result = await library.extractDetail({ url: input.url, ...options });
    assert.equal(result.document, null);
    assert.ok(result.diagnostics.length > 0);
  }
});

test('detail keeps raw API values private and rejects dangerous resource URLs', async () => {
  const result = await library.extractDetail({ url: input.url, json: {
    body: 'Safe public text', internalField: 'not-public-data', files: ['javascript:alert(1)', '/spec.docx']
  }, config: { fields: { content: 'body', attachments: 'files' } } });
  assert.equal(JSON.stringify(result).includes('not-public-data'), false);
  assert.deepEqual(result.document.attachments, [{ url: 'https://example.test/spec.docx', title: '' }]);
  assert.ok(result.diagnostics.some((item) => item.code === 'INVALID_RESOURCE_URL'));
});

test('detail follows final HTTP URL for relative resources and rejects binary bodies', async () => {
  const server = http.createServer((request, response) => {
    if (request.url === '/start') { response.writeHead(302, { location: '/reports/page' }); response.end(); }
    else if (request.url === '/binary') {
      response.writeHead(200, { 'content-type': 'application/pdf' }); response.end('%PDF-1.4 binary');
    } else {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<article><h1>Redirected report</h1><p>The full body after redirection.</p><a download href="spec.pdf">Specification</a></article>');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const result = await library.extractDetail({ url: `${base}/start` });
    assert.equal(result.document.url, `${base}/reports/page`);
    assert.equal(result.document.attachments[0].url, `${base}/reports/spec.pdf`);
    const binary = await library.extractDetail({ url: `${base}/binary` });
    assert.equal(binary.document, null);
    assert.ok(binary.diagnostics.some((item) => item.code === 'UNSUPPORTED_CONTENT_TYPE'));
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('configured API fetch uses the page URL as the document and resource base', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(String(url), 'https://example.test/api/detail/1');
    return new Response(JSON.stringify({ content: 'API provided content', files: ['spec.pdf'] }), {
      headers: { 'content-type': 'application/json' }
    });
  };
  try {
    const result = await library.extractDetail({ url: input.url, config: {
      apiUrl: '/api/detail/1', fields: { content: 'content', attachments: 'files' }
    } });
    assert.equal(result.document.url, input.url);
    assert.equal(result.document.attachments[0].url, 'https://example.test/reports/spec.pdf');
  } finally { globalThis.fetch = original; }
});

test('known platform details use their APIs and return full document content', async () => {
  const cases = [
    ['https://ctzc.nncytz.com/#/notice/detail/123', '/ctzc/service/notice/get/123', { data: { title: 'Industry report', content: '<p>Industry full body.</p>' } }],
    ['https://cg.example.test/researchApp/announcementInfo/123/xbgg/common', '/api/business/open/api/queryBulletinDetail', { result: { title: 'Hospital report', content: '<p>Hospital full body.</p>' } }],
    ['https://www.ccgp-guangxi.gov.cn/site/detail?articleId=abc', '/portal/detail', { result: { data: { title: 'Procurement report', content: '<p>Procurement full body.</p>' } } }]
  ];
  const original = globalThis.fetch;
  try {
    for (const [url, endpoint, payload] of cases) {
      let calls = 0;
      globalThis.fetch = async (requested) => {
        calls += 1; assert.ok(String(requested).includes(endpoint));
        return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
      };
      const result = await library.extractDetail({ url });
      assert.match(result.document.contentText, /full body/);
      assert.equal(calls, 1);
    }
  } finally { globalThis.fetch = original; }
});

test('rate limits and dynamic API failures do not become empty success or browser bypasses', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('Too many requests', { status: 429 });
  try {
    for (const url of [input.url, 'https://ctzc.nncytz.com/#/notice/detail/123']) {
      const result = await library.extractDetail({ url, config: { browserFallback: true }, browserModule: '__missing_browser__' });
      assert.equal(result.document, null);
      assert.ok(result.diagnostics.some((item) => /429/.test(item.message)));
      assert.equal(result.diagnostics.some((item) => item.code === 'CAPABILITY_DEPENDENCY_MISSING'), false);
    }
  } finally { globalThis.fetch = original; }
});

test('malformed detail API responses do not leak body fragments through parser errors', async () => {
  const original = globalThis.fetch;
  try {
    for (const contentType of ['application/json', 'text/plain']) {
      globalThis.fetch = async () => new Response('private-response-fragment', {
        headers: { 'content-type': contentType }
      });
      for (const args of [
        { url: input.url, config: { mode: 'json', fields: { content: 'content' } } },
        { url: 'https://ctzc.nncytz.com/#/notice/detail/123' }
      ]) {
        const result = await library.extractDetail(args);
        assert.equal(result.document, null);
        assert.ok(result.diagnostics.some((item) => ['INVALID_JSON', 'DETAIL_API_FAILED'].includes(item.code)));
        assert.doesNotMatch(JSON.stringify(result), /private-re/);
      }
    }
  } finally { globalThis.fetch = original; }
});

test('browser route reports a missing driver and does not use a supplied snapshot instead', async () => {
  const result = await library.extractDetail({ ...input, config: { mode: 'browser' }, browserModule: '__missing_browser__' });
  assert.equal(result.document, null);
  assert.ok(result.diagnostics.some((item) => item.code === 'CAPABILITY_DEPENDENCY_MISSING'));
});

test('automatic mode diagnoses SPA shells without silently launching a browser', async () => {
  const result = await library.extractDetail({ url: input.url, html: '<div id="app">Loading...</div><script src="app.js"></script>', browserModule: '__missing_browser__' });
  assert.equal(result.document, null);
  assert.ok(result.diagnostics.some((item) => item.code === 'DYNAMIC_RENDERING_REQUIRED'));
  assert.equal(result.diagnostics.some((item) => item.code === 'CAPABILITY_DEPENDENCY_MISSING'), false);
});
