import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { buildBundle } from '../src/index.mjs';

test('bundle is reproducible and records a SHA256 for every copied file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'web-cap-bundle-'));
  const first = await buildBundle({ outputDir: path.join(root, 'one') });
  const second = await buildBundle({ outputDir: path.join(root, 'two') });

  assert.equal(first.bundleSha256, second.bundleSha256);
  assert.ok(first.files.length > 5);
  assert.ok(first.files.every((item) => /^[a-f0-9]{64}$/.test(item.sha256)));
});

test('standalone consumer extracts records using only the generated bundle', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'web-cap-consumer-'));
  const bundleDir = path.join(root, 'bundle');
  await buildBundle({ outputDir: bundleDir });
  const consumer = fileURLToPath(
    new URL('../examples/standalone-consumer/run.mjs', import.meta.url)
  );
  const htmlFile = fileURLToPath(new URL('../fixtures/static-list.html', import.meta.url));

  const result = spawnSync(
    process.execPath,
    [consumer, '--bundle', bundleDir, '--html-file', htmlFile],
    { encoding: 'utf8' }
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.capabilityId, 'static-html-list');
});
