import assert from 'node:assert/strict';
import test from 'node:test';

import { scanTextForSecrets } from '../src/security-audit.mjs';

test('secret audit flags credential-shaped values without echoing the secret', () => {
  const fakeSecret = `ghp_${'x'.repeat(36)}`;
  const findings = scanTextForSecrets('example.txt', `TOKEN=${fakeSecret}`);

  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, 'GITHUB_TOKEN');
  assert.equal(JSON.stringify(findings).includes(fakeSecret), false);
});

test('secret audit permits explicit documentation placeholders', () => {
  const findings = scanTextForSecrets(
    '.env.example',
    'LARK_TOKEN=your-token\nOPENAI_API_KEY=replace-me\nPASSWORD=<application-owned>'
  );

  assert.deepEqual(findings, []);
});
