import assert from 'node:assert/strict';
import test from 'node:test';

import * as library from '../src/index.mjs';
import { reset, state } from './helpers/detail-browser-driver.mjs';

const browserModule = new URL('./helpers/detail-browser-driver.mjs', import.meta.url).href;
const url = 'https://example.test/start';
const article = '<article><h1>Rendered report</h1><p>The complete rendered report has useful public details.</p></article>';
const shell = '<div id="app">Loading...</div><script src="/app.js"></script>';
const challenge = '<main><h1>Human verification</h1><form><label>CAPTCHA</label><input name="captcha"><button>Verify</button></form></main>';
const codes = (result) => result.diagnostics.map((item) => item.code);
const extract = (options = {}) => library.extractDetail({ url, browserModule, config: { mode: 'browser' }, ...options });

let originalFetch;
test.beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Unexpected network access in browser contract test'); };
});
test.afterEach(() => { globalThis.fetch = originalFetch; });

function assertNoBrowser() {
  assert.deepEqual(state.launches, []);
  assert.deepEqual(state.connections, []);
  assert.deepEqual(state.pages, []);
}

test('browser detail waits for navigation and both click kinds before extracting the final rendered article', async () => {
  reset({
    html: shell,
    steps: [
      { html: '<button id="expand">Read full report</button>', url: 'https://example.test/reports/summary' },
      { html: '<article><h1>Expanded report</h1><time datetime="2026-09-11"></time><p>Entire rendered body after both clicks.</p><table><tr><th>Item</th></tr><tr><td>Service</td></tr></table><img src="chart.png" alt="Chart"><a download href="spec.pdf">Specification</a></article>', url: 'https://example.test/reports/final/index.html' }
    ]
  });
  const result = await extract({
    html: '<article><p>Stale supplied snapshot.</p></article>',
    config: {
      mode: 'browser', waitUntil: 'domcontentloaded', timeoutMs: 4321,
      clicks: [{ text: 'Full report', exact: false, waitUntil: 'load' }, { selector: '#expand' }]
    }
  });

  assert.equal(result.capabilityId, 'web-page-detail');
  assert.equal(result.capabilityVersion, library.LIBRARY_VERSION);
  assert.equal('records' in result, false);
  assert.equal(result.document.title, 'Expanded report');
  assert.equal(result.document.url, 'https://example.test/reports/final/index.html');
  assert.equal(result.document.publishedAt, '2026-09-11');
  assert.match(result.document.contentText, /Entire rendered body after both clicks/);
  assert.doesNotMatch(result.document.contentText, /Stale supplied snapshot/);
  assert.equal(result.document.tables[0].rows[1][0].text, 'Service');
  assert.deepEqual(result.document.images, [{ url: 'https://example.test/reports/final/chart.png', alt: 'Chart' }]);
  assert.deepEqual(result.document.attachments, [{ url: 'https://example.test/reports/final/spec.pdf', title: 'Specification' }]);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(state.events.filter((item) => item.event === 'goto'), [
    { event: 'goto', url, options: { waitUntil: 'domcontentloaded', timeout: 4321 } }
  ]);
  assert.deepEqual(state.events.filter((item) => item.event === 'click').map(({ kind, value, options }) => ({ kind, value, options })), [
    { kind: 'text', value: 'Full report', options: { exact: false } },
    { kind: 'selector', value: '#expand', options: undefined }
  ]);
  assert.equal(state.browserCloses, 1);
  assert.ok(state.pages.every((page) => page.closed));
});

test('browser detail uses the URL after initial navigation for relative resources', async () => {
  reset({ html: '<article><p>Redirected rendered body.</p><a href="report.pdf">Report</a></article>', finalUrl: 'https://example.test/final/page.html' });
  const result = await extract();
  assert.equal(result.document.url, 'https://example.test/final/page.html');
  assert.equal(result.document.attachments[0].url, 'https://example.test/final/report.pdf');
});

for (const status of [401, 403, 429, 500]) {
  test(`browser initial HTTP ${status} is an explicit failure before any configured clicks`, async () => {
    reset({ status, html: '<main><h1>Too Many Requests</h1><p>Request limit exceeded. Retry after a few minutes.</p></main>' });
    const result = await extract({ config: { mode: 'browser', clicks: [{ text: 'Continue' }] } });
    assert.equal(result.document, null);
    assert.ok(result.diagnostics.some((item) => item.code === 'HTTP_ERROR' && item.message.includes(String(status))));
    assert.deepEqual(state.events.filter((item) => item.event === 'click'), []);
    assert.equal(state.browserCloses, 1);
    assert.ok(state.pages.every((page) => page.closed));
  });
}

for (const status of [429, 500]) {
  test(`browser clicked main-document HTTP ${status} fails and stops later clicks`, async () => {
    reset({ html: article, steps: [
      { status, url: 'https://example.test/reports/error', html: '<main><h1>Request failed</h1><p>The requested page is temporarily unavailable. Retry later.</p></main>' }
    ] });
    const result = await extract({ config: { mode: 'browser', clicks: [{ text: 'Full report' }, { selector: '#next' }] } });
    assert.equal(result.document, null);
    assert.ok(result.diagnostics.some((item) => item.code === 'HTTP_ERROR' && item.message.includes(String(status))));
    assert.equal(state.events.filter((item) => item.event === 'click').length, 1);
    assert.equal(state.browserCloses, 1);
    assert.ok(state.pages.every((page) => page.closed));
  });
}

for (const [label, response] of [
  ['subresource HTTP 404', { status: 404, url: 'https://example.test/missing.png', navigation: false, main: true }],
  ['child-frame navigation HTTP 500', { status: 500, url: 'https://example.test/embedded', navigation: true, main: false }]
]) {
  test(`browser ${label} does not hide a successful main document`, async () => {
    reset({ html: shell, steps: [{ status: 200, url: 'https://example.test/reports/final', html: article, responses: [response] }] });
    const result = await extract({ config: { mode: 'browser', clicks: [{ text: 'Full report' }] } });
    assert.match(result.document.contentText, /complete rendered report/);
    assert.equal(result.document.url, 'https://example.test/reports/final');
    assert.ok(!codes(result).includes('HTTP_ERROR'));
    assert.equal(state.browserCloses, 1);
  });
}

test('rendered article prose mentioning password or CAPTCHA is not treated as a login or challenge', async () => {
  reset({ html: '<article><h1>Account help</h1><p>This complete tutorial explains password management, login forms and CAPTCHA accessibility for readers.</p><p>No account is needed to read the public tutorial.</p></article>' });
  const result = await extract();
  assert.match(result.document.contentText, /password management, login forms and CAPTCHA/);
  assert.ok(!codes(result).includes('HUMAN_VERIFICATION_REQUIRED'));
  assert.ok(!codes(result).includes('AUTH_SESSION_REQUIRED'));
});

test('a rendered human challenge requires human verification and returns no document', async () => {
  reset({ html: challenge });
  const result = await extract();
  assert.equal(result.document, null);
  assert.ok(codes(result).includes('HUMAN_VERIFICATION_REQUIRED'));
  assert.equal(state.browserCloses, 1);
});

test('a rendered password login form without article content requires an application session', async () => {
  reset({ html: '<main><h1>Sign in</h1><form><label>Password<input type="password" name="password"></label><button>Login</button></form></main>' });
  const result = await extract();
  assert.equal(result.document, null);
  assert.ok(codes(result).includes('AUTH_SESSION_REQUIRED'));
});

for (const failure of ['gotoError', 'clickError', 'waitError']) {
  test(`browser detail diagnoses ${failure} and releases its launched browser`, async () => {
    reset({ html: article, [failure]: 'Synthetic browser operation failed' });
    const result = await extract({ config: { mode: 'browser', clicks: [{ selector: '#expand' }] } });
    assert.equal(result.document, null);
    assert.ok(codes(result).includes('BROWSER_EXECUTION_FAILED'));
    assert.equal(state.browserCloses, 1);
    assert.ok(state.pages.every((page) => page.closed));
  });
}

for (const failure of [null, 'gotoError', 'clickError']) {
  test(`CDP attachment closes its own page then disconnects without closing the external browser (${failure || 'success'})`, async () => {
    reset({ html: article, ...(failure ? { [failure]: 'Synthetic operation failed' } : {}) });
    const result = await extract({ config: { mode: 'browser', cdpEndpoint: 'http://127.0.0.1:9222', clicks: [{ text: 'Read full report' }] } });
    if (failure) {
      assert.equal(result.document, null);
      assert.ok(codes(result).includes('BROWSER_EXECUTION_FAILED'));
    } else assert.match(result.document.contentText, /complete rendered report/);
    assert.deepEqual(state.connections, ['http://127.0.0.1:9222']);
    assert.deepEqual(state.launches, []);
    assert.deepEqual(state.newContexts, []);
    assert.equal(state.pages.length, 1);
    assert.equal(state.pages[0].closeCalls, 1);
    assert.equal(state.pages[0].closed, true);
    assert.deepEqual(state.cdpConnections, [{ connected: false, disconnects: 1 }]);
    assert.deepEqual(state.events.filter((item) => ['page.close', 'browser.disconnect'].includes(item.event)), [
      { event: 'page.close' }, { event: 'browser.disconnect' }
    ]);
    assert.equal(state.browserCloses, 0);
    assert.equal(state.contextCloses, 0);
    assert.equal(state.externalBrowser.closed, false);
    assert.equal(state.externalBrowser.contexts[0].closed, false);
    assert.equal(state.externalBrowser.contexts[0].pages.length, 2);
    assert.equal(state.externalBrowser.contexts[0].pages[0].closed, false);
  });
}

test('CDP keepBrowserOpen preserves its connection and page while the external browser stays alive', async () => {
  reset({ html: article });
  const result = await extract({ config: { mode: 'browser', cdpEndpoint: 'http://127.0.0.1:9222', keepBrowserOpen: true } });
  assert.match(result.document.contentText, /complete rendered report/);
  assert.deepEqual(state.connections, ['http://127.0.0.1:9222']);
  assert.deepEqual(state.cdpConnections, [{ connected: true, disconnects: 0 }]);
  assert.equal(state.pages.length, 1);
  assert.equal(state.pages[0].closeCalls, 0);
  assert.equal(state.pages[0].closed, false);
  assert.equal(state.browserCloses, 0);
  assert.equal(state.contextCloses, 0);
  assert.equal(state.externalBrowser.closed, false);
  assert.equal(state.externalBrowser.contexts[0].closed, false);
  assert.ok(state.externalBrowser.contexts[0].pages.every((page) => !page.closed));
});

test('application-owned storage state reaches the browser context and explicit keep-open preserves it', async () => {
  reset({ html: article });
  const result = await extract({ config: { mode: 'browser', storageStatePath: 'synthetic-app-session.json', headless: false, keepBrowserOpen: true } });
  assert.match(result.document.contentText, /complete rendered report/);
  assert.deepEqual(state.launches, [{ headless: false }]);
  assert.deepEqual(state.newContexts, [{ storageState: 'synthetic-app-session.json' }]);
  assert.equal(state.browserCloses, 0);
  assert.equal(state.contextCloses, 0);
  assert.equal(state.pages[0].closed, false);
  assert.ok(!JSON.stringify(result).includes('synthetic-app-session.json'));
});

test('auto mode starts the browser for an empty SPA shell only with explicit browser fallback', async () => {
  reset({ html: article });
  const declined = await extract({ html: shell, config: { mode: 'auto' } });
  assert.equal(declined.document, null);
  assert.ok(codes(declined).includes('DYNAMIC_RENDERING_REQUIRED'));
  assertNoBrowser();

  const accepted = await extract({ html: shell, config: { mode: 'auto', browserFallback: true } });
  assert.match(accepted.document.contentText, /complete rendered report/);
  assert.equal(state.launches.length, 1);
  assert.equal(state.pages.length, 1);
});

test('auto mode with explicit fallback does not launch a browser when static content is already usable', async () => {
  reset({ html: '<article><p>Unexpected browser content.</p></article>' });
  const result = await extract({ html: article, config: { mode: 'auto', browserFallback: true } });
  assert.match(result.document.contentText, /complete rendered report/);
  assertNoBrowser();
});

test('auto mode with explicit fallback never attempts to bypass a human challenge', async () => {
  reset({ html: article });
  const result = await extract({ html: challenge, config: { mode: 'auto', browserFallback: true } });
  assert.equal(result.document, null);
  assert.ok(codes(result).includes('HUMAN_VERIFICATION_REQUIRED'));
  assertNoBrowser();
});

test('auto mode does not mistake ordinary missing content for a dynamic rendering requirement', async () => {
  reset({ html: article });
  const result = await extract({ html: '<main><h1>Empty document</h1></main>', config: { mode: 'auto', browserFallback: true } });
  assert.equal(result.document, null);
  assert.ok(codes(result).includes('DETAIL_CONTENT_NOT_FOUND'));
  assertNoBrowser();
});

test('auto mode with explicit fallback does not launch a browser for a login barrier', async () => {
  reset({ html: article });
  const result = await extract({ html: '<main><form><input type="password"><button>Sign in</button></form></main>', config: { mode: 'auto', browserFallback: true } });
  assert.equal(result.document, null);
  assert.ok(codes(result).includes('AUTH_SESSION_REQUIRED'));
  assertNoBrowser();
});

test('auto mode with explicit fallback never launches a browser after HTTP 429', async () => {
  reset({ html: article });
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return new Response('Too many requests', { status: 429 });
  };
  try {
    const result = await extract({ config: { mode: 'auto', browserFallback: true } });
    assert.equal(result.document, null);
    assert.ok(result.diagnostics.some((item) => item.code === 'HTTP_ERROR' && /429/.test(item.message)));
    assert.equal(requests, 1);
    assertNoBrowser();
  } finally {
    globalThis.fetch = originalFetch;
  }
});
