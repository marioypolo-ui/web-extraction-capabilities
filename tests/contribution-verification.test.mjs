import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { buildBundle, packContribution, verifyContribution } from '../src/index.mjs';

async function pack(modern = true, baseVersion = '0.1.0') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'central-verifier-'));
  const sourceDir = path.join(root, 'source');
  await fs.cp(new URL('../examples/capability-contribution/', import.meta.url), sourceDir, { recursive: true });
  if (modern) await fs.writeFile(path.join(sourceDir, 'contribution.json'), JSON.stringify({
    schemaVersion: 1, changeType: 'new-capability',
    base: { capabilityId: 'static-html-list', capabilityVersion: baseVersion, libraryVersion: '0.2.0' },
    targetType: 'static-html', appliesTo: ['Synthetic cards'], notAppliesTo: ['Login'],
    conditions: { network: 'offline', governmentDirect: true, login: false, human: false }, dependencies: [],
    entryPoint: { file: 'adapter.mjs', export: 'extractExampleCards', signature: 'input-v1' },
    verification: { command: ['node', '--test', 'adapter.test.mjs'], cases: [{ id: 'card', fixture: 'fixture.html',
      operation: 'list', url: 'https://example.test/', baselineExpectation: 'fails',
      expected: { records: [{ title: 'Synthetic', url: 'https://example.test/1' }], diagnosticCodes: [] } }] }
  }));
  const contributionDir = path.join(root, 'pack');
  await packContribution({ sourceDir, outputDir: contributionDir });
  return contributionDir;
}

test('independent verifier preserves legacy needs-evidence and rejects changed pack bytes', async () => {
  const legacy = await verifyContribution({ contributionDir: await pack(false) });
  assert.equal(legacy.status, 'needs-evidence');
  assert.equal(legacy.verifiedContribution, false);
  const contributionDir = await pack();
  await fs.appendFile(path.join(contributionDir, 'adapter.mjs'), '\n// changed');
  const altered = await verifyContribution({ contributionDir });
  assert.equal(altered.status, 'rejected');
  assert.deepEqual(altered.reasons, ['CONTRIBUTION_FILE_HASH_MISMATCH']);
});

test('trusted baseline metadata and actual files must both match maintenance pins', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'central-verifier-baseline-'));
  const bundleDir = path.join(root, 'bundle');
  const manifest = await buildBundle({ outputDir: bundleDir });
  const pin = () => fs.readFile(path.join(bundleDir, 'bundle-manifest.json')).then((bytes) =>
    createHash('sha256').update(bytes).digest('hex'));
  const baseline = { bundleDir, bundleSha256: manifest.bundleSha256, manifestSha256: await pin() };
  const image = `sha256:${'0'.repeat(64)}`;
  const contributionDir = await pack();
  const mismatch = await verifyContribution({ contributionDir, baseline, image });
  assert.deepEqual(mismatch.reasons, ['BASELINE_CAPABILITY_MISMATCH']);
  assert.equal(mismatch.verifiedContribution, false);
  const unavailable = await verifyContribution({ contributionDir: await pack(true, '0.1.1'), baseline, image });
  assert.equal(unavailable.status, 'blocked');
  assert.equal(['LINUX_CONTAINER_ENGINE_UNAVAILABLE', 'PINNED_LOCAL_IMAGE_UNAVAILABLE'].includes(unavailable.reasons[0]), true);
  assert.equal(unavailable.verifiedContribution, false);
  const originalManifest = await fs.readFile(path.join(bundleDir, 'bundle-manifest.json'));
  await fs.appendFile(path.join(bundleDir, 'bundle-manifest.json'), '\n');
  const metadataTampered = await verifyContribution({ contributionDir, baseline, image });
  assert.deepEqual(metadataTampered.reasons, ['BASELINE_PIN_MISMATCH']);
  await fs.writeFile(path.join(bundleDir, 'bundle-manifest.json'), originalManifest);
  await fs.appendFile(path.join(bundleDir, 'src/index.mjs'), '\n// modified');
  const codeTampered = await verifyContribution({ contributionDir, baseline, image });
  assert.deepEqual(codeTampered.reasons, ['BASELINE_PIN_MISMATCH']);
  assert.equal(codeTampered.verifiedContribution, false);
});

test('independent verifier requires externally pinned baseline and never trusts application receipts', async () => {
  const contributionDir = await pack();
  const result = await verifyContribution({ contributionDir,
    applicationVerification: { passed: true }, baseline: { bundleDir: 'SYNTHETIC_PRIVATE_PATH' } });
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.reasons, ['PINNED_BASELINE_REQUIRED']);
  assert.equal(result.verifiedContribution, false);
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE_PATH'), false);
});

test('independent verifier refuses a floating image before reading any baseline code', async () => {
  const result = await verifyContribution({ contributionDir: await pack(), image: 'node:22',
    baseline: { bundleDir: 'unused', bundleSha256: '0'.repeat(64), manifestSha256: '0'.repeat(64) } });
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.reasons, ['PINNED_LOCAL_IMAGE_REQUIRED']);
  assert.equal(result.verifiedContribution, false);
});
