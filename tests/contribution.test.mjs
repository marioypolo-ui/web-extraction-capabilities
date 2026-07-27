import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { packContribution } from '../src/index.mjs';

async function makeCapability(root) {
  const source = path.join(root, 'sample-capability');
  await fs.mkdir(source, { recursive: true });
  await fs.writeFile(
    path.join(source, 'capability.json'),
    JSON.stringify({
      id: 'sample-capability',
      version: '0.1.0',
      type: 'static-html',
      scope: 'generic',
      status: 'supported',
      detection: ['A synthetic marker exists'],
      appliesTo: ['Synthetic fixture'],
      notAppliesTo: ['Unknown pages'],
      requirements: { http: true },
      implementation: 'adapter.mjs',
      fixtures: ['fixture.html'],
      tests: ['adapter.test.mjs']
    })
  );
  await fs.writeFile(path.join(source, 'adapter.mjs'), 'export const id = "sample-capability";\n');
  await fs.writeFile(path.join(source, 'fixture.html'), '<p>Synthetic fixture</p>\n');
  await fs.writeFile(path.join(source, 'adapter.test.mjs'), 'export {};\n');
  return source;
}

test('contribution pack contains a validated capability and checksums', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'web-cap-contribution-'));
  const sourceDir = await makeCapability(root);
  const outputDir = path.join(root, 'packed');

  const packed = await packContribution({ sourceDir, outputDir });

  assert.equal(packed.capabilityId, 'sample-capability');
  assert.ok(packed.files.every((item) => /^[a-f0-9]{64}$/.test(item.sha256)));
  assert.ok(packed.files.some((item) => item.path === 'capability.json'));
});

test('contribution pack rejects workflow and dependency changes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'web-cap-contribution-'));
  const sourceDir = await makeCapability(root);
  await fs.mkdir(path.join(sourceDir, '.github', 'workflows'), { recursive: true });
  await fs.writeFile(path.join(sourceDir, '.github', 'workflows', 'unsafe.yml'), 'run: arbitrary\n');

  await assert.rejects(
    () => packContribution({ sourceDir, outputDir: path.join(root, 'packed') }),
    /forbidden contribution path/
  );
});

test('contribution pack rejects a manifest outside the public schema', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'web-cap-contribution-'));
  const sourceDir = await makeCapability(root);
  const manifestPath = path.join(sourceDir, 'capability.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.scope = 'secret-internal-mode';
  await fs.writeFile(manifestPath, JSON.stringify(manifest));

  await assert.rejects(
    () => packContribution({ sourceDir, outputDir: path.join(root, 'packed') }),
    /scope must be one of/
  );
});
