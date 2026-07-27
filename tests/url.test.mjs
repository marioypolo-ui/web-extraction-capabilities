import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeUrl } from '../src/index.mjs';

test('URL normalization removes tracking parameters and sorts stable query parameters', () => {
  assert.equal(
    normalizeUrl('HTTPS://Example.TEST:443/path?utm_source=x&b=2&a=1#fragment'),
    'https://example.test/path?a=1&b=2'
  );
});

test('URL normalization preserves SPA routes used as record identities', () => {
  assert.equal(
    normalizeUrl('https://example.test/#/notice/detail/42?type=result'),
    'https://example.test/#/notice/detail/42?type=result'
  );
});
