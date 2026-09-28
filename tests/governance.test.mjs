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
  assert.match(workflow, /npm run schema:validate/);
  assert.match(workflow, /ajv@8\.17\.1 ajv-formats@3\.0\.1/);
  assert.match(workflow, /--ignore-scripts/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /push:/);
});

test('legacy author/path auto-merge cannot bypass independent contribution acceptance', () => {
  const workflow = fs.readFileSync(
    path.join(root, '.github/workflows/trusted-auto-merge.yml'),
    'utf8'
  );

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /permissions: \{\}/);
  assert.match(workflow, /LEGACY_AUTO_MERGE_DISABLED/);
  assert.doesNotMatch(workflow, /workflow_run:|TRUSTED_CAPABILITY_AUTHORS|GH_TOKEN|gh pr merge|contents: write|pull-requests: write/);
  assert.doesNotMatch(workflow, /actions\/checkout/);
  assert.doesNotMatch(workflow, /npm (?:test|install|ci)/);
});

test('retired problem feedback cannot execute submissions, read event samples or acquire write credentials', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/problem-feedback.yml'), 'utf8');
  assert.match(workflow, /permissions: \{\}/);
  assert.match(workflow, /LEGACY_PUBLICATION_DISABLED/);
  assert.doesNotMatch(workflow, /actions\/checkout|GITHUB_EVENT_PATH|GH_TOKEN|upload-artifact/);
  assert.doesNotMatch(workflow, /npm (?:test|install|ci)|problem-intake\.mjs/);
  assert.doesNotMatch(workflow, /issues: write|contents: read/);
  assert.doesNotMatch(workflow, /\$\{\{[^\n}]*(?:issue\.body|head\.ref|head\.sha)/);
  assert.doesNotMatch(workflow, /pull_request_target|contents: write|id-token: write|secrets\./);
});
