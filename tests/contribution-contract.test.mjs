import assert from 'node:assert/strict';
import test from 'node:test';
import { validateContributionContract } from '../src/contribution-contract.mjs';

function contract(changeType = 'capability-fix') {
  return { schemaVersion: 1, changeType,
    base: { capabilityId: 'static-html-list', capabilityVersion: '0.1.0', libraryVersion: '0.2.0' },
    targetType: 'static-html', appliesTo: ['Synthetic card lists'], notAppliesTo: ['Login pages'],
    conditions: { network: 'offline', governmentDirect: true, login: false, human: false },
    dependencies: [], entryPoint: { file: 'adapter.mjs', export: 'extract', signature: 'input-v1' },
    verification: { command: ['node', '--test', 'adapter.test.mjs'], cases: [
      { id: 'missing-card', fixture: 'fixture.html', operation: 'list', url: 'https://example.test/',
        expected: { records: [{ title: 'Synthetic', url: 'https://example.test/1' }], diagnosticCodes: [] },
        baselineExpectation: 'fails' },
      { id: 'existing-card', fixture: 'old.html', operation: 'list', url: 'https://example.test/',
        expected: { records: [{ title: 'Old', url: 'https://example.test/old' }], diagnosticCodes: [] },
        baselineExpectation: 'passes' }
    ] }
  };
}

test('modern contracts require independent before/after and old-behaviour cases', () => {
  assert.equal(validateContributionContract(contract()).ok, true);
  const value = contract();
  value.verification.cases = value.verification.cases.slice(1);
  assert.equal(validateContributionContract(value).ok, false);
  value.verification.cases = [contract().verification.cases[0]];
  assert.equal(validateContributionContract(value).ok, false);
});

test('new types and website references have different baseline requirements', () => {
  const value = contract('new-capability');
  value.verification.cases = [value.verification.cases[0]];
  assert.equal(validateContributionContract(value).ok, true);
  const reference = contract('website-reference');
  delete reference.entryPoint;
  reference.verification.cases = [reference.verification.cases[1]];
  assert.equal(validateContributionContract(reference).ok, true);
  reference.entryPoint = contract().entryPoint;
  assert.equal(validateContributionContract(reference).ok, false);
});

test('no arbitrary command, path escape, skipped evidence or self-reported receipt is accepted', () => {
  const mutations = [
    (v) => { v.verification.command = ['powershell', '-Command', 'echo passed']; },
    (v) => { v.verification.command = ['node', '--test', '--test-name-pattern=only-green']; },
    (v) => { v.entryPoint.file = '../outside.mjs'; },
    (v) => { v.verification.cases[0].fixture = 'C:/private.html'; },
    (v) => { v.verification.cases[0].skip = true; },
    (v) => { v.applicationVerification = { passed: true }; },
    (v) => { v.conditions.governmentDirect = false; },
    (v) => { v.verification.cases[0].expected = { count: 1 }; },
    (v) => { v.dependencies = ['unapproved-package']; },
    (v) => { v.verification.cases[0].expected.records[0].url = 'http://localhost/'; }
  ];
  for (const mutate of mutations) {
    const value = contract(); mutate(value);
    const result = validateContributionContract(value);
    assert.equal(result.ok, false);
    assert.ok(result.reasons.length);
    assert.equal(JSON.stringify(result).includes('private.html'), false);
  }
});

test('legacy missing metadata needs evidence rather than silently becoming verified', () => {
  assert.deepEqual(validateContributionContract(null), {
    ok: false, status: 'needs-evidence', reasons: ['CONTRIBUTION_CONTRACT_REQUIRED']
  });
});

test('detail expectations validate complete nested tables, resources and dates', () => {
  const value = contract('new-capability');
  const item = value.verification.cases[0];
  item.operation = 'detail';
  item.expected = { diagnosticCodes: [], document: { title: 'Synthetic', url: 'https://example.test/1',
    publishedAt: null, contentText: 'Full synthetic body.',
    tables: [{ caption: 'Table', rows: [[{ text: 'Cell', rowSpan: 1, colSpan: 1, header: false }]] }],
    images: [{ url: 'https://example.test/image.png', alt: 'Image' }],
    attachments: [{ url: 'https://example.test/file.pdf', title: 'File' }] } };
  assert.equal(validateContributionContract(value).ok, true);
  for (const change of [
    (d) => { d.tables[0].rows[0][0].colSpan = 0; },
    (d) => { d.images[0].alt = 22; },
    (d) => { d.attachments[0].extra = 'undeclared'; },
    (d) => { d.publishedAt = {}; }
  ]) {
    const copy = structuredClone(value);
    change(copy.verification.cases[0].expected.document);
    assert.equal(validateContributionContract(copy).ok, false);
  }
});

test('offline case config rejects networking, execution and business-policy fields', () => {
  for (const config of [{ http: { proxy: 'https://example.test/' } }, { mode: 'browser' },
    { fields: { title: '__proto__.value' } }, { includeRaw: true }, { businessKeywords: ['Synthetic'] },
    { contentSelector: 3 }, { actionUrlTemplate: 'https://example.test/no-placeholder' }]) {
    const value = contract(); value.verification.cases[0].config = config;
    assert.equal(validateContributionContract(value).ok, false);
  }
  const value = contract();
  value.verification.cases[0].config = { mode: 'static', contentSelector: 'article.body',
    fields: { title: 'data.title' }, actionUrlTemplate: 'https://example.test/item/{id}' };
  assert.equal(validateContributionContract(value).ok, true);
});
