import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import { problemKey, reproduceProblem, validateProblemReport } from '../src/problem-feedback.mjs';
import { LIBRARY_VERSION } from '../src/result.mjs';

const example = async (name) => JSON.parse(await fs.readFile(new URL(`../examples/problem-feedback/${name}.json`, import.meta.url), 'utf8'));
const report = (overrides = {}) => ({
  schemaVersion: 1, sanitized: true, operation: 'detail', symptom: 'missing-body',
  pageUrl: 'https://example.test/detail/1', libraryVersion: '0.2.0', capabilityId: 'web-page-detail', capabilityVersion: '0.2.0',
  target: { title: 'Synthetic notice', url: 'https://example.test/detail/1' },
  sample: { format: 'html', stage: 'static', content: '<article><h1>Synthetic notice</h1><p>Complete body.</p></article>' },
  expected: { contentIncludes: ['Complete body.'] }, ...overrides
});

test('synthetic examples validate and distinguish a complete detail from a reproduced list omission', async () => {
  const detail = await example('detail');
  const list = await example('list');
  assert.equal(validateProblemReport(detail).ok, true);
  assert.equal(validateProblemReport(list).ok, true);
  const success = await reproduceProblem(detail);
  const omission = await reproduceProblem(list);
  assert.equal(success.status, 'not-reproduced');
  assert.equal(success.ok, true);
  assert.equal(omission.status, 'reproduced');
  assert.equal(omission.ok, true);
  assert.equal(success.testedVersion, LIBRARY_VERSION);
  assert.equal(success.reportedVersion, '0.2.0');
  assert.ok(success.checks.every((check) => check.passed));
  assert.ok(omission.checks.some((check) => !check.passed));
});

test('deduplication ignores versions, titles, samples, capability identity, fragments and tracking query parameters', () => {
  const first = report({ pageUrl: 'https://EXAMPLE.test:443/detail/1?b=2&utm_source=a&a=1#heading' });
  const second = report({ pageUrl: 'https://example.test/detail/1?a=1&b=2', libraryVersion: '1.2.3-beta.1', capabilityVersion: '2.0.0', capabilityId: 'other-capability',
    target: { title: 'Changed title', url: 'https://example.test/detail/1?utm_campaign=x' },
    sample: { format: 'html', stage: 'rendered', content: '<main>Another saved sample</main>' } });
  assert.match(problemKey(first), /^[a-f0-9]{64}$/);
  assert.equal(problemKey(first), problemKey(second));
  assert.notEqual(problemKey(first), problemKey({ ...first, symptom: 'missing-title' }));
  assert.equal(problemKey({ ...first, sanitized: false }), null);
});

test('strict object whitelists reject unknown fields at every report configuration boundary', () => {
  for (const field of ['root', 'target', 'sample', 'config', 'fields', 'expected']) {
    const value = report();
    if (field === 'root') value.cookiePath = '/private';
    else if (field === 'fields') value.config = { fields: { title: 'title', browserModule: 'unsafe' } };
    else value[field] = { ...(value[field] || {}), secretUnknown: 'private-value' };
    const result = validateProblemReport(value);
    assert.equal(result.ok, false, field);
    assert.ok(!JSON.stringify(result).includes('private-value'));
    assert.ok(!JSON.stringify(result).includes('secretUnknown'));
  }
});

test('runtime and executable configuration is rejected before any replay', async () => {
  for (const config of [{ http: {} }, { mode: 'browser' }, { browserModule: './execute.mjs' }, { cdpUrl: 'http://localhost:9222' },
    { cookiePath: '/private' }, { fields: { content: 'constructor.constructor' } }, { itemsPath: 'data.items()' },
    { contentSelector: '(() => fetch("https://example.test"))()' }, { actionUrlTemplate: 'javascript:open({id})' }, { actionLinkTemplate: '/notice/{id}' }]) {
    const result = await reproduceProblem(report({ config }));
    assert.equal(result.status, 'invalid');
    assert.equal(result.ok, false);
  }
});

test('only plain finite JSON data is accepted without invoking accessors or toJSON', () => {
  let invoked = false;
  const getter = report();
  Object.defineProperty(getter, 'config', { enumerable: true, get() { invoked = true; throw new Error('private'); } });
  assert.equal(validateProblemReport(getter).ok, false);
  assert.equal(invoked, false);
  const custom = report();
  custom.toJSON = () => { invoked = true; return {}; };
  assert.equal(validateProblemReport(custom).ok, false);
  assert.equal(invoked, false);
  const cycle = report(); cycle.config = cycle;
  assert.equal(validateProblemReport(cycle).ok, false);
  assert.equal(validateProblemReport(new Date()).ok, false);
});

test('reports and decoded samples enforce size, depth, array and individual field limits', () => {
  assert.equal(validateProblemReport(report({ sample: { format: 'html', stage: 'static', content: 'x'.repeat(40001) } })).ok, false);
  assert.equal(validateProblemReport(report({ expected: { contentIncludes: Array(21).fill('x') } })).ok, false);
  assert.equal(validateProblemReport(report({ target: { title: 'x'.repeat(501), url: 'https://example.test/' } })).ok, false);
  assert.equal(validateProblemReport(report({ sample: { format: 'json', stage: 'api', content: '['.repeat(30) + '0' + ']'.repeat(30) } })).ok, false);
  assert.equal(validateProblemReport(report({ sample: { format: 'html', stage: 'static', content: 'x'.repeat(40000) }, expected: {
    contentIncludes: Array(20).fill('x'.repeat(1000)), tableTextIncludes: Array(20).fill('x'.repeat(1000)) } })).ok, false);
});

test('private and credential-bearing URLs are rejected including normalized IP representations', () => {
  for (const pageUrl of ['http://localhost/', 'http://localhost./', 'http://intranet/', 'http://host.internal/', 'http://127.1/', 'http://2130706433/',
    'http://0x7f000001/', 'http://10.1.2.3/', 'http://100.64.0.1/', 'http://169.254.169.254/', 'http://172.20.0.1/', 'http://192.168.1.1/',
    'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[fd00::1]/', 'http://[fe80::1]/',
    'https://user:pass@example.test/', 'https://example.test/?access_token=redacted', 'https://example.test/?%2574oken=value', 'https://example.test/#access_token=redacted']) {
    assert.equal(validateProblemReport(report({ pageUrl })).ok, false, pageUrl);
  }
  assert.equal(validateProblemReport(report({ pageUrl: 'https://www.example.org/' })).ok, true);
  assert.equal(validateProblemReport(report({ expected: { contentIncludes: ['body'], imageUrls: ['http://127.0.0.1/a.png'] } })).ok, false);
});

test('secret-shaped sample data is rejected even on lines containing placeholders or example markers', () => {
  const fakeToken = `ghp_${'z'.repeat(36)}`;
  const cases = [`<p>example dummy ${fakeToken}</p>`, 'example ACCESS_TOKEN="nonpublic-value"',
    '<input type="password" value="nonpublic-value">', '<a href="https://example.test/?token=nonpublic-value">example</a>',
    '-----BEGIN PRIVATE KEY-----\nexample\n-----END PRIVATE KEY-----'];
  for (const content of cases) {
    const result = validateProblemReport(report({ sample: { format: 'html', stage: 'static', content } }));
    assert.equal(result.ok, false);
    assert.ok(!JSON.stringify(result).includes(fakeToken));
    assert.ok(!JSON.stringify(result).includes('nonpublic-value'));
  }
});

test('symptoms require meaningful corresponding expectations and valid operation combinations', () => {
  for (const symptom of ['missing-body', 'missing-table', 'missing-image', 'missing-attachment', 'wrong-date']) {
    assert.equal(validateProblemReport(report({ symptom, expected: {} })).ok, false, symptom);
  }
  assert.equal(validateProblemReport(report({ operation: 'list', symptom: 'missing-body' })).ok, false);
  assert.equal(validateProblemReport(report({ symptom: 'missing-record' })).ok, false);
  assert.equal(validateProblemReport(report({ expected: { contentIncludes: ['   '] } })).ok, false);
  assert.equal(validateProblemReport(report({ sample: { format: 'json', stage: 'static', content: '{}' } })).ok, false);
});

test('offline replay never fetches or runs sample JavaScript, including rendered and platform snapshots', async () => {
  let fetched = false;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () => { fetched = true; throw new Error('Network forbidden'); };
  try {
    const saved = report();
    saved.sample.stage = 'rendered';
    saved.sample.content += '<script>globalThis.feedbackExecuted = true; fetch("https://example.test/never");</script><button onclick="globalThis.feedbackExecuted=true">Action</button>';
    assert.equal((await reproduceProblem(saved)).status, 'not-reproduced');
    const platform = await example('list');
    platform.capabilityId = 'tender-platform-families';
    await reproduceProblem(platform);
    assert.equal(fetched, false);
    assert.equal(globalThis.feedbackExecuted, undefined);
  } finally { globalThis.fetch = previousFetch; }
});

test('JSON list and detail replay use configured pure field mappings', async () => {
  const detail = report({ sample: { format: 'json', stage: 'api', content: '{"data":{"name":"Synthetic notice","body":"Complete body."}}' },
    config: { itemPath: 'data', fields: { title: 'name', content: 'body' } } });
  assert.equal((await reproduceProblem(detail)).status, 'not-reproduced');
  const list = report({ operation: 'list', symptom: 'missing-record', expected: undefined,
    sample: { format: 'json', stage: 'api', content: '{"data":[{"name":"Synthetic notice","link":"/detail/1"}]}' },
    config: { itemsPath: 'data', fields: { title: 'name', url: 'link' } } });
  delete list.expected;
  assert.equal((await reproduceProblem(list)).status, 'not-reproduced');
});

test('target title and URL must belong to the same list record', async () => {
  const input = report({ operation: 'list', symptom: 'missing-link', sample: { format: 'html', stage: 'static',
    content: '<ul><li><a href="/other">Synthetic notice</a></li><li><a href="/detail/1">Different title</a></li></ul>' } });
  delete input.expected;
  const result = await reproduceProblem(input);
  assert.equal(result.status, 'reproduced');
  assert.ok(result.checks.some((check) => !check.passed));
});

test('all supplied detail expectations must pass, not merely the reported symptom', async () => {
  const value = await example('detail');
  value.expected.imageUrls.push('https://example.test/missing.png');
  const result = await reproduceProblem(value);
  assert.equal(result.status, 'reproduced');
  assert.equal(result.checks.find((check) => check.field === 'expected.imageUrls[1]').passed, false);
  assert.equal(result.checks.find((check) => check.field === 'expected.contentIncludes[0]').passed, true);
});

test('malformed JSON is invalid and parser exceptions require a maintainer without leaking input or exception text', async () => {
  const invalid = await reproduceProblem(report({ sample: { format: 'json', stage: 'api', content: '{private-invalid' } }));
  assert.equal(invalid.status, 'invalid');
  assert.ok(!JSON.stringify(invalid).includes('private-invalid'));
  const value = report({ operation: 'list', symptom: 'missing-title', sample: { format: 'html', stage: 'static',
    content: '<ul><li><a href="/detail/1">&#1114112;</a></li></ul>' } });
  delete value.expected;
  const failed = await reproduceProblem(value);
  assert.equal(failed.status, 'needs-maintainer');
  assert.equal(failed.ok, false);
  assert.ok(!JSON.stringify(failed).includes('1114112'));
});

test('receipts only contain compact verdicts and never include original sample or parser documents', async () => {
  const value = await example('detail');
  const result = await reproduceProblem(value);
  assert.deepEqual(Object.keys(result).sort(), ['ok', 'problemKey', 'status', 'reportedVersion', 'testedVersion', 'operation', 'symptom', 'replayMode', 'checks', 'diagnosticCodes'].sort());
  assert.ok(!JSON.stringify(result).includes('Complete synthetic body.'));
  assert.ok(!JSON.stringify(result).includes('<article>'));
  for (const check of result.checks) assert.deepEqual(Object.keys(check).sort(), ['field', 'passed']);
});

test('JSON reports require parser mappings and permit an explicit empty detail itemPath for the root object', async () => {
  const content = '{"title":"Synthetic notice","body":"Complete body."}';
  const detail = report({ sample: { format: 'json', stage: 'api', content }, config: { itemPath: '', fields: { title: 'title', content: 'body' } } });
  assert.equal(validateProblemReport(detail).ok, true);
  assert.equal((await reproduceProblem(detail)).status, 'not-reproduced');
  const missingDetailMapping = report({ sample: { format: 'json', stage: 'api', content } });
  assert.equal((await reproduceProblem(missingDetailMapping)).status, 'invalid');
  const missingListMapping = report({ operation: 'list', symptom: 'missing-record', sample: { format: 'json', stage: 'api', content: '{"items":[]}' }, config: { itemsPath: 'items' } });
  delete missingListMapping.expected;
  assert.equal((await reproduceProblem(missingListMapping)).status, 'invalid');
});

test('empty saved HTML is a valid offline sample that reproduces missing content', async () => {
  const value = report({ sample: { format: 'html', stage: 'static', content: '' } });
  const result = await reproduceProblem(value);
  assert.equal(result.status, 'reproduced');
  assert.ok(result.diagnosticCodes.includes('DETAIL_CONTENT_NOT_FOUND'));
});

test('the existing actionUrlTemplate name resolves saved action links without execution', async () => {
  const value = report({ operation: 'list', symptom: 'missing-link', config: { actionUrlTemplate: '/detail/{id}' },
    sample: { format: 'html', stage: 'static', content: '<ul><li><a href="#" data-id="1">Synthetic notice</a></li></ul>' } });
  delete value.expected;
  assert.equal((await reproduceProblem(value)).status, 'not-reproduced');
});
