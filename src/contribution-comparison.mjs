import { isDeepStrictEqual } from 'node:util';
import { isBoundedPlainJson } from './problem-feedback.mjs';

// Runs in the trusted controller, outside the untrusted candidate's process.
// Only fixed check names and booleans are returned; no expected/actual content.
export function compareContributionResult(item, result) {
  const checks = [];
  const check = (field, passed) => checks.push({ field, passed: Boolean(passed) });
  if (!isBoundedPlainJson(result, 16) || !result || typeof result !== 'object' ||
    !Array.isArray(result.diagnostics) || result.diagnostics.some((d) => !d || typeof d !== 'object' ||
      typeof d.code !== 'string' || !/^[A-Z][A-Z0-9_]{0,79}$/.test(d.code))) {
    return { passed: false, checks: [{ field: 'result-shape', passed: false }] };
  }
  if (!item?.expected || !['list', 'detail'].includes(item.operation)) {
    return { passed: false, checks: [{ field: 'case-shape', passed: false }] };
  }
  const expected = item.expected;
  check('diagnostics', isDeepStrictEqual(result.diagnostics.map((d) => d.code).sort(),
    Array.isArray(expected.diagnosticCodes) ? [...expected.diagnosticCodes].sort() : null));
  if (item.operation === 'list') {
    check('records-shape', Array.isArray(result.records) && Array.isArray(expected.records));
    if (Array.isArray(result.records) && Array.isArray(expected.records)) {
      check('record-count', result.records.length === expected.records.length);
      for (let i = 0; i < expected.records.length; i += 1) {
        const actual = result.records[i];
        check(`record-${i}`, actual && typeof actual === 'object' &&
          Object.entries(expected.records[i]).every(([key, value]) => isDeepStrictEqual(actual[key], value)));
      }
      check('empty-diagnostic', result.records.length !== 0 || result.diagnostics.length !== 0);
    }
  } else {
    check('document', isDeepStrictEqual(result.document, expected.document));
    check('empty-diagnostic', result.document !== null || result.diagnostics.length !== 0);
  }
  return { passed: checks.every((entry) => entry.passed), checks };
}
