#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { extractDetail } from '../src/index.mjs';

const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
const moduleName = args.includes('--browser-module') ? option('--browser-module') : 'playwright';
const channel = args.includes('--channel') ? option('--channel') : undefined;
const playwright = await import(moduleName);
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'web-detail-browser-smoke-'));
const shimFile = path.join(temp, 'driver.mjs');
const realModuleUrl = import.meta.resolve(moduleName);
await fs.writeFile(shimFile, `import { chromium as real } from ${JSON.stringify(realModuleUrl)};
export const state = { connections: [] };
export const chromium = {
  launch: (options) => real.launch({ ...options, channel: ${JSON.stringify(channel)} }),
  async connectOverCDP(...args) { const browser = await real.connectOverCDP(...args); state.connections.push(browser); return browser; }
};\n`, 'utf8');
const browserModule = pathToFileURL(shimFile).href;
const driver = await import(browserModule);
const report = '<article id="report"><h1>Rendered local report</h1><p>Complete browser-rendered public detail.</p><table><tr><td>Service</td></tr></table><a download href="spec.pdf">Specification</a></article>';
const server = http.createServer((request, response) => {
  response.setHeader('content-type', 'text/html; charset=utf-8');
  if (request.url === '/rate') {
    response.statusCode = 429;
    response.end('<main><p>Too many requests. Retry later.</p></main>');
  } else if (request.url === '/app') {
    response.end(`<div id="app"></div><button id="expand">Open report</button><script>document.querySelector('#expand').onclick = () => { document.querySelector('#app').innerHTML = ${JSON.stringify(report)}; };</script>`);
  } else {
    response.end('<article><h1>Existing page</h1><p>This page belongs to the test application.</p></article>');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let owner;
try {
  const direct = await extractDetail({ url: `${base}/app`, browserModule,
    config: { mode: 'browser', clicks: [{ selector: '#expand' }] } });
  assert.equal(direct.document?.title, 'Rendered local report');
  assert.equal(direct.document.tables[0].rows[0][0].text, 'Service');
  assert.equal(direct.document.attachments[0].url, `${base}/spec.pdf`);
  const failure = await extractDetail({ url: `${base}/rate`, browserModule, config: { mode: 'browser' } });
  assert.equal(failure.document, null);
  assert.ok(failure.diagnostics.some((item) => item.code === 'HTTP_ERROR' && item.message.includes('429')));

  const profile = path.join(temp, 'profile');
  owner = await playwright.chromium.launchPersistentContext(profile, {
    headless: true, channel, args: ['--remote-debugging-port=0']
  });
  const existing = owner.pages()[0];
  await existing.goto(`${base}/existing`);
  const [port] = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/);
  const cdpEndpoint = `http://127.0.0.1:${port}`;
  const attached = await extractDetail({ url: `${base}/app`, browserModule,
    config: { mode: 'browser', cdpEndpoint, clicks: [{ selector: '#expand' }] } });
  assert.equal(attached.document?.title, 'Rendered local report');
  assert.equal(driver.state.connections.at(-1).isConnected(), false);
  assert.equal(existing.isClosed(), false);
  assert.match(await existing.textContent('body'), /belongs to the test application/);
  assert.equal(owner.pages().length, 1);
  const attachedFailure = await extractDetail({ url: `${base}/rate`, browserModule,
    config: { mode: 'browser', cdpEndpoint } });
  assert.equal(attachedFailure.document, null);
  assert.equal(driver.state.connections.at(-1).isConnected(), false);
  assert.equal(owner.pages().length, 1);
  assert.equal(existing.isClosed(), false);
  console.log(JSON.stringify({ ok: true, browser: await existing.evaluate(() => navigator.userAgent),
    checks: ['rendered-content', 'table', 'attachment-url', 'HTTP-429', 'CDP-success-disconnect',
      'CDP-failure-disconnect', 'existing-page-preserved'], externalSitesAccessed: false }));
} finally {
  for (const browser of driver.state.connections) await browser.close().catch(() => {});
  await owner?.close();
  await new Promise((resolve) => server.close(resolve));
  // This directory was created by this invocation and contains only its test profile and shim.
  await fs.rm(temp, { recursive: true, force: true });
}
