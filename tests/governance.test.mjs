import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('..', import.meta.url));

test('documented commands pass the automated smoke runner', () => {
  const result = spawnSync(process.execPath, ['scripts/docs-smoke.mjs'], {
    cwd: root,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).ok, true);
});

test('CI enforces tests, docs smoke, catalog validation, and sensitive-content audit', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');

  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run validate/);
  assert.match(workflow, /npm run docs:smoke/);
  assert.match(workflow, /npm run audit:sensitive/);
  assert.match(workflow, /npm run audit:history/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /push:/);
});

test('trusted auto-merge workflow never checks out or executes pull request code', () => {
  const workflow = fs.readFileSync(
    path.join(root, '.github/workflows/trusted-auto-merge.yml'),
    'utf8'
  );

  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /TRUSTED_CAPABILITY_AUTHORS/);
  assert.doesNotMatch(workflow, /actions\/checkout/);
  assert.doesNotMatch(workflow, /npm (?:test|install|ci)/);
});

test('problem feedback executes default-branch code and treats issue text only as event data', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/problem-feedback.yml'), 'utf8');
  assert.match(workflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /queue: max/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /--event "\$GITHUB_EVENT_PATH"/);
  assert.match(workflow, /issues: write/);
  assert.doesNotMatch(workflow, /\$\{\{[^\n}]*(?:issue\.body|head\.ref|head\.sha)/);
  assert.doesNotMatch(workflow, /pull_request_target|contents: write|id-token: write|secrets\./);
});
