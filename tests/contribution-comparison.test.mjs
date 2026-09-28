import assert from 'node:assert/strict';
import test from 'node:test';
import { compareContributionResult } from '../src/contribution-comparison.mjs';

const item = { operation: 'list', expected: { records: [
  { title: 'First', url: 'https://example.test/1', publishedAt: '2026-09-24' },
  { title: 'Second', url: 'https://example.test/2', publishedAt: null }
], diagnosticCodes: [] } };
const result = () => ({ records: structuredClone(item.expected.records), diagnostics: [] });

test('trusted comparison checks every record, not a count or a claimed success', () => {
  assert.equal(compareContributionResult(item, result()).passed, true);
  for (const mutate of [
    (r) => { r.records[0].title = 'Wrong'; },
    (r) => { r.records[0].url = r.records[1].url; },
    (r) => { r.records[0].publishedAt = null; },
    (r) => { r.records.reverse(); },
    (r) => { r.records.pop(); },
    (r) => { r.records.push(r.records[0]); },
    (r) => { r.diagnostics = [{ code: 'FETCH_FAILED' }]; }
  ]) {
    const output = result(); mutate(output); output.passed = true;
    const receipt = compareContributionResult(item, output);
    assert.equal(receipt.passed, false);
    assert.equal(JSON.stringify(receipt).includes('Wrong'), false);
    assert.equal(JSON.stringify(receipt).includes('https://'), false);
  }
});

test('detail comparison checks body end, dates, tables and resource links without disclosing them', () => {
  const document = { title: 'Report', url: 'https://example.test/r', publishedAt: null,
    contentText: 'First paragraph. Last paragraph.',
    tables: [{ caption: '', rows: [[{ text: 'Cell', colSpan: 2, rowSpan: 1, header: false }]] }],
    images: [{ url: 'https://example.test/a.png', alt: 'Picture' }],
    attachments: [{ url: 'https://example.test/a.pdf', title: 'Document' }] };
  const detail = { operation: 'detail', expected: { document, diagnosticCodes: [] } };
  assert.equal(compareContributionResult(detail, { document, diagnostics: [] }).passed, true);
  for (const mutate of [
    (d) => { d.contentText = 'First paragraph.'; },
    (d) => { d.tables[0].rows[0][0].colSpan = 1; },
    (d) => { d.images = []; },
    (d) => { d.attachments[0].url = 'https://example.test/wrong.pdf'; },
    (d) => { d.publishedAt = '2026-09-24'; }
  ]) {
    const changed = structuredClone(document); mutate(changed);
    assert.equal(compareContributionResult(detail, { document: changed, diagnostics: [] }).passed, false);
  }
});

test('malformed output, silent empty success and unsupported operations cannot satisfy comparison', () => {
  for (const value of [null, { passed: true }, { records: [], diagnostics: [] },
    { records: item.expected.records, diagnostics: ['FETCH_FAILED'] }]) {
    assert.equal(compareContributionResult(item, value).passed, false);
  }
  assert.equal(compareContributionResult({ operation: 'other', expected: {} }, result()).passed, false);
});
