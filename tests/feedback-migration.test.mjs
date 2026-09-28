import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { publishProblem } from '../scripts/problem-intake.mjs';

test('default programmatic legacy publication neither reads receipts nor creates a GitHub client', async () => {
  const result = await publishProblem({ outputDir: 'DO-NOT-READ', environment: {} });
  assert.equal(result.reason, 'LEGACY_PUBLICATION_DISABLED');
  assert.equal(result.autoSubmit, false);
});

test('legacy intake CLI refuses prepare/publish before reading event files or credentials', () => {
  for (const command of ['prepare', 'publish']) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/problem-intake.mjs', import.meta.url)),
      command, '--event', 'DO-NOT-READ-PRIVATE-EVENT.json', '--output', 'DO-NOT-WRITE'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.status, 'application-owned');
    assert.equal(receipt.reason, 'LEGACY_PUBLICATION_DISABLED');
    assert.equal(receipt.autoSubmit, false);
    assert.equal(result.stdout.includes('DO-NOT-READ'), false);
    assert.equal(result.stderr, '');
  }
});

test('retired feedback workflow has no issue/comment trigger, write token or sample artifact upload', async () => {
  const source = await fs.readFile(new URL('../.github/workflows/problem-feedback.yml', import.meta.url), 'utf8');
  assert.match(source, /workflow_dispatch:/);
  assert.doesNotMatch(source, /^  (issues|issue_comment):/m);
  assert.doesNotMatch(source, /issues:\s*write|GH_TOKEN|upload-artifact|problem-intake\.mjs\s+(prepare|publish)/);
  assert.match(source, /LEGACY_PUBLICATION_DISABLED/);
});

test('public legacy form no longer invites users to paste samples or visit lists', async () => {
  const source = await fs.readFile(new URL('../.github/ISSUE_TEMPLATE/problem-feedback.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /type: textarea|render: json|label: Feedback JSON/);
  assert.match(source, /本地/);
  assert.match(source, /贡献/);
});
