import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildBundle, LIBRARY_VERSION, validateBundle } from '../src/index.mjs';

async function makeBundle() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'web-cap-bundle-validation-'));
  const bundleDir = path.join(root, 'bundle');
  await buildBundle({ outputDir: bundleDir });
  return bundleDir;
}

async function readManifest(bundleDir) {
  return JSON.parse(await fs.readFile(path.join(bundleDir, 'bundle-manifest.json'), 'utf8'));
}

async function writeManifest(bundleDir, manifest) {
  await fs.writeFile(
    path.join(bundleDir, 'bundle-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
}

test('generated runtime bundle validates without source fixtures or tests', async () => {
  const bundleDir = await makeBundle();
  const manifest = await validateBundle({ bundleDir, expectedVersion: LIBRARY_VERSION });

  assert.equal(manifest.bundleFormatVersion, 1);
  assert.equal(manifest.version, LIBRARY_VERSION);
  await assert.rejects(fs.access(path.join(bundleDir, 'fixtures')));
  await assert.rejects(fs.access(path.join(bundleDir, 'tests')));
});

test('rejects unsupported bundle formats', async () => {
  const bundleDir = await makeBundle();
  const manifest = await readManifest(bundleDir);
  manifest.bundleFormatVersion = 2;
  await writeManifest(bundleDir, manifest);

  await assert.rejects(validateBundle({ bundleDir }), /unsupported bundle format/i);
});

test('rejects unsafe bundle paths', async () => {
  const bundleDir = await makeBundle();
  const manifest = await readManifest(bundleDir);
  manifest.files[0].path = '../outside.mjs';
  await writeManifest(bundleDir, manifest);

  await assert.rejects(validateBundle({ bundleDir }), /unsafe bundle path/i);
});

test('rejects trailing slashes that alias a bundle file on Windows', async () => {
  const bundleDir = await makeBundle();
  const manifest = await readManifest(bundleDir);
  manifest.files.find((entry) => entry.path === 'README.md').path = 'README.md/';
  await writeManifest(bundleDir, manifest);

  await assert.rejects(validateBundle({ bundleDir }), /unsafe bundle path/i);
});

test('rejects absolute bundle paths', async () => {
  const bundleDir = await makeBundle();
  const manifest = await readManifest(bundleDir);
  manifest.files[0].path = path.resolve(bundleDir, 'outside.mjs');
  await writeManifest(bundleDir, manifest);

  await assert.rejects(validateBundle({ bundleDir }), /unsafe bundle path/i);
});

test('rejects backslash-containing bundle paths', async () => {
  const bundleDir = await makeBundle();
  const manifest = await readManifest(bundleDir);
  manifest.files.find((entry) => entry.path === 'src/index.mjs').path = 'src\\index.mjs';
  await writeManifest(bundleDir, manifest);

  await assert.rejects(validateBundle({ bundleDir }), /unsafe bundle path/i);
});

test('rejects non-normalized bundle paths', async () => {
  const bundleDir = await makeBundle();
  const manifest = await readManifest(bundleDir);
  manifest.files.find((entry) => entry.path === 'src/index.mjs').path = 'src//index.mjs';
  await writeManifest(bundleDir, manifest);

  await assert.rejects(validateBundle({ bundleDir }), /unsafe bundle path/i);
});

test('rejects duplicate bundle paths', async () => {
  const bundleDir = await makeBundle();
  const manifest = await readManifest(bundleDir);
  manifest.files.push({ ...manifest.files[0] });
  await writeManifest(bundleDir, manifest);

  await assert.rejects(validateBundle({ bundleDir }), /duplicate bundle path/i);
});

test('rejects bundle files with mismatched SHA256 values', async () => {
  const bundleDir = await makeBundle();
  const manifest = await readManifest(bundleDir);
  const entry = manifest.files.find((item) => item.path === 'src/index.mjs');
  await fs.appendFile(path.join(bundleDir, ...entry.path.split('/')), '\n// altered\n', 'utf8');

  await assert.rejects(validateBundle({ bundleDir }), /SHA256 mismatch/i);
});

test('rejects bundles missing required runtime entry points', async () => {
  const bundleDir = await makeBundle();
  const manifest = await readManifest(bundleDir);
  manifest.files = manifest.files.filter((entry) => entry.path !== 'src/index.mjs');
  await writeManifest(bundleDir, manifest);

  await assert.rejects(validateBundle({ bundleDir }), /required runtime entry point/i);
});

test('rejects symlinked bundle entries when supported by the platform', async () => {
  const bundleDir = await makeBundle();
  const entryPath = path.join(bundleDir, 'src', 'index.mjs');
  await fs.rm(entryPath);
  try {
    await fs.symlink('../package.json', entryPath);
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      return;
    }
    throw error;
  }

  await assert.rejects(validateBundle({ bundleDir }), /links are not allowed/i);
});

test('rejects symlinked bundle directories when supported by the platform', async () => {
  const bundleDir = await makeBundle();
  const sourceDir = path.join(bundleDir, 'source-src');
  const entryDir = path.join(bundleDir, 'src');
  await fs.rename(entryDir, sourceDir);
  try {
    await fs.symlink(sourceDir, entryDir, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      return;
    }
    throw error;
  }

  await assert.rejects(validateBundle({ bundleDir }), /links are not allowed/i);
});

test('rejects bundles with an invalid aggregate SHA256', async () => {
  const bundleDir = await makeBundle();
  const manifest = await readManifest(bundleDir);
  manifest.bundleSha256 = '0'.repeat(64);
  await writeManifest(bundleDir, manifest);

  await assert.rejects(validateBundle({ bundleDir }), /aggregate SHA256 mismatch/i);
});

test('rejects malformed capability summaries', async () => {
  const bundleDir = await makeBundle();
  const manifest = await readManifest(bundleDir);
  manifest.capabilities[0].verifiedTargets = 'not-an-array';
  await writeManifest(bundleDir, manifest);

  await assert.rejects(validateBundle({ bundleDir }), /verifiedTargets must be an array/i);
});

test('rejects bundles with a mismatched expected version', async () => {
  const bundleDir = await makeBundle();

  await assert.rejects(
    validateBundle({ bundleDir, expectedVersion: '9.9.9' }),
    /does not match expected version/i
  );
});
