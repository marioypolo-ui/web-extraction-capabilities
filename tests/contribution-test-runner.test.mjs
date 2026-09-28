import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const runner = fileURLToPath(new URL('../src/runners/contribution-tests.mjs', import.meta.url));
// These are trusted synthetic tests authored here, never external contribution code.
async function execute(body) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'central-runner-test-'));
  await fs.writeFile(path.join(cwd, 'case.test.mjs'), `import test from 'node:test';\n${body}\n`);
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [runner, 'case.test.mjs'], {
    cwd, encoding: 'utf8', timeout: 15000, env
  });
}

test('trusted test runner records a real failure followed by a repaired pass', async () => {
  const red = await execute("test('case', () => { throw new Error('SYNTHETIC_PRIVATE_MARKER'); });");
  assert.equal(red.status, 1);
  assert.equal(JSON.parse(red.stdout).ok, false);
  assert.equal((red.stdout + red.stderr).includes('SYNTHETIC_PRIVATE_MARKER'), false);
  const green = await execute("test('case', () => {});");
  assert.equal(green.status, 0);
  assert.deepEqual(JSON.parse(green.stdout), { ok: true, tests: 1, passed: 1, failed: 0, skipped: 0, todo: 0, cancelled: 0 });
});

test('skipped, todo and empty tests cannot become successful evidence', async () => {
  for (const body of ["test.skip('case', () => {});", "test.todo('case');", '']) {
    const result = await execute(body);
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).ok, false);
  }
});

test('stdout receipts and test names are not trusted or echoed', async () => {
  const result = await execute(`console.log('{"ok":true,"tests":99}');
    console.error('SYNTHETIC_PRIVATE_MARKER');
    test('SYNTHETIC_PRIVATE_MARKER', () => { throw new Error('failed'); });`);
  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, false);
  assert.equal(receipt.tests, 1);
  assert.equal((result.stdout + result.stderr).includes('SYNTHETIC_PRIVATE_MARKER'), false);
});
