import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { extract } from '../src/index.mjs';

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('fixed DNS extraction connects to an explicit IP while preserving the requested Host', async () => {
  let port;
  const server = http.createServer((request, response) => {
    assert.equal(request.headers.host, `records.example.test:${port}`);
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(
      '<ul><li><span>2026-07-22</span><a href="/record/1">Fixed host record</a></li></ul>'
    );
  });
  await listen(server);
  port = server.address().port;

  try {
    const result = await extract({
      capabilityId: 'fixed-dns-host',
      url: `http://records.example.test:${port}/list`,
      config: { resolveIp: '127.0.0.1' }
    });
    assert.equal(result.records[0].title, 'Fixed host record');
    assert.deepEqual(result.diagnostics, []);
  } finally {
    await close(server);
  }
});

test('domain migration uses only the explicit hostname rewrite map', async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(
      '<ul><li><span>2026-07-22</span><a href="/record/2">Migrated domain record</a></li></ul>'
    );
  });
  await listen(server);
  const port = server.address().port;

  try {
    const result = await extract({
      capabilityId: 'domain-migration',
      url: `http://old.example.test:${port}/list`,
      config: { rewriteMap: { 'old.example.test': '127.0.0.1' } }
    });
    assert.equal(result.records[0].title, 'Migrated domain record');
    assert.deepEqual(result.diagnostics, []);
  } finally {
    await close(server);
  }
});

test('fetch failure is returned as a structured diagnostic', async () => {
  const result = await extract({
    capabilityId: 'fixed-dns-host',
    url: 'http://unreachable.example.test:1/list',
    config: { resolveIp: '127.0.0.1', http: { timeoutMs: 100 } }
  });

  assert.deepEqual(result.records, []);
  assert.ok(result.diagnostics.some((item) => item.code === 'FETCH_FAILED'));
});
