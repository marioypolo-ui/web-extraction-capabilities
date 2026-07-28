import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildBundle,
  createBundleRuntime,
  LIBRARY_VERSION
} from '../src/index.mjs';

const staticInput = {
  capabilityId: 'static-html-list',
  url: 'https://example.test/notices/',
  html: await fs.readFile(new URL('../fixtures/static-list.html', import.meta.url), 'utf8')
};

async function makeBundle(name) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'web-cap-bundle-runtime-'));
  const bundleDir = path.join(root, name);
  await buildBundle({ outputDir: bundleDir });
  return bundleDir;
}

test('loads immutable bundle runtimes in isolation', async () => {
  const currentDir = await makeBundle('current');
  const candidateDir = await makeBundle('candidate');
  const brokenDir = await makeBundle('broken');
  const current = await createBundleRuntime({
    bundleDir: currentDir,
    expectedVersion: LIBRARY_VERSION
  });
  const candidate = await createBundleRuntime({
    bundleDir: candidateDir,
    expectedVersion: LIBRARY_VERSION
  });

  assert.notEqual(current.bundleDir, candidate.bundleDir);
  assert.equal(Object.isFrozen(current), true);
  assert.equal(current.version, LIBRARY_VERSION);
  assert.equal(candidate.version, LIBRARY_VERSION);

  const currentResult = await current.extract(staticInput);
  const candidateResult = await candidate.extract(staticInput);
  assert.deepEqual(currentResult, candidateResult);
  assert.notEqual(current.extract, candidate.extract);

  await fs.appendFile(path.join(brokenDir, 'src', 'index.mjs'), '\n// altered\n', 'utf8');
  await assert.rejects(createBundleRuntime({ bundleDir: brokenDir }), /SHA256 mismatch/i);
  assert.equal((await current.extract(staticInput)).records.length, 2);
});

test('validate: false requires a matching expected version', async () => {
  const bundleDir = await makeBundle('trusted');

  await assert.rejects(
    createBundleRuntime({ bundleDir, expectedVersion: '9.9.9', validate: false }),
    /does not match expected version/i
  );

  const runtime = await createBundleRuntime({
    bundleDir,
    expectedVersion: LIBRARY_VERSION,
    validate: false
  });
  assert.equal(runtime.version, LIBRARY_VERSION);
});

test('validate: false rejects a manifest version that differs from the bundle module', async () => {
  const bundleDir = await makeBundle('manifest-version-mismatch');
  const manifestPath = path.join(bundleDir, 'bundle-manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.version = '9.9.9';
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  await assert.rejects(
    createBundleRuntime({ bundleDir, validate: false }),
    /module version .* does not match manifest/i
  );
});
