import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('..', import.meta.url));
const report = {
  schemaVersion: 1, sanitized: true, operation: 'detail', symptom: 'missing-body',
  pageUrl: 'https://example.test/article/1', libraryVersion: '0.2.0',
  capabilityId: 'web-page-detail', capabilityVersion: '0.2.0',
  target: { title: 'Sample notice', url: 'https://example.test/article/1' },
  sample: { format: 'html', stage: 'static', content: '<article><h1>Sample notice</h1><p>The complete body.</p></article>' },
  expected: { contentIncludes: ['The complete body.'] }
};

test('feedback CLI validates and reproduces a local report with explicit pass and failure exit codes', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'web-feedback-cli-'));
  const file = path.join(directory, 'report.json');
  const run = (command) => spawnSync(process.execPath, ['bin/web-extract.mjs', command, '--report', file], { cwd: root, encoding: 'utf8' });
  try {
    await fs.writeFile(file, JSON.stringify(report));
    const validation = run('feedback:validate');
    assert.equal(validation.status, 0, validation.stdout);
    assert.match(JSON.parse(validation.stdout).problemKey, /^[a-f0-9]{64}$/);
    const passing = run('feedback:reproduce');
    assert.equal(passing.status, 0, passing.stdout);
    assert.equal(JSON.parse(passing.stdout).status, 'not-reproduced');
    await fs.writeFile(file, JSON.stringify({ ...report, expected: { contentIncludes: ['Missing final paragraph.'] } }));
    const failing = run('feedback:reproduce');
    assert.equal(failing.status, 1, failing.stdout);
    assert.equal(JSON.parse(failing.stdout).status, 'reproduced');
    assert.ok(!failing.stdout.includes(report.sample.content));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('feedback CLI rejects malformed JSON without echoing its contents', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'web-feedback-cli-'));
  try {
    const file = path.join(directory, 'report.json');
    await fs.writeFile(file, '{ confidential-sample-fragment');
    const result = spawnSync(process.execPath, ['bin/web-extract.mjs', 'feedback:validate', '--report', file], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).error.code, 'COMMAND_FAILED');
    assert.ok(!result.stdout.includes('confidential-sample-fragment'));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
