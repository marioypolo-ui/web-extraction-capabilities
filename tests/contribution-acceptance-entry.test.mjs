import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('real isolation acceptance refuses absent pins with a nonzero exit, never skipped success', () => {
  const result = spawnSync(process.execPath, ['scripts/contribution-isolation-acceptance.mjs'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8'
  });
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout), { ok: false, status: 'blocked',
    reason: 'PINNED_ACCEPTANCE_INPUTS_REQUIRED', completedChecks: [] });
});

test('manual isolation workflow separates pinned public acquisition from credential-free execution', async () => {
  const text = await fs.readFile(new URL('../.github/workflows/contribution-isolation.yml', import.meta.url), 'utf8');
  assert.match(text, /workflow_dispatch:/);
  assert.match(text, /persist-credentials: false/);
  assert.match(text, /contents: read/);
  assert.match(text, /node@sha256:/);
  assert.match(text, /sha256sum --check --status/);
  assert.match(text, /npm run test:contribution-isolation/);
  assert.doesNotMatch(text, /pull_request_target|secrets\.|GH_TOKEN|contents: write|id-token: write|upload-artifact|continue-on-error/);
  assert.doesNotMatch(text, /\$\{\{.*(?:issue\.body|head\.ref|head\.sha)/);
});

test('stable publication depends on the same-commit isolated acceptance job', async () => {
  const isolation = await fs.readFile(new URL('../.github/workflows/contribution-isolation.yml', import.meta.url), 'utf8');
  const release = await fs.readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  assert.match(isolation, /workflow_call:/);
  assert.match(release, /isolation-acceptance:\s+permissions:\s+contents: read\s+uses: \.\/\.github\/workflows\/contribution-isolation\.yml/);
  assert.match(release, /release:\s+needs: isolation-acceptance/);
  assert.doesNotMatch(release, /continue-on-error|if:.*always\(/);
});
