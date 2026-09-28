import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { packContribution } from '../src/index.mjs';
import { disclosureDigest } from '../src/contribution-privacy.mjs';

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
      verifiedTargets: [],
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

async function makeWebsiteReference(root, referenceUrl = 'https://example.test/notices') {
  const source = path.join(root, 'website-reference');
  await fs.mkdir(source, { recursive: true });
  const parsed = new URL(referenceUrl);
  await fs.writeFile(
    path.join(source, 'reference.json'),
    JSON.stringify({
      capabilityId: 'static-html-list',
      baseCapabilityVersion: '0.1.0',
      target: {
        name: 'Synthetic public reference',
        referenceUrl,
        match: { host: parsed.hostname, pathPrefix: parsed.pathname },
        verification: 'fixture-tested',
        verifiedAt: '2026-07-27',
        evidence: ['fixture.html', 'reference.test.mjs']
      }
    })
  );
  await fs.writeFile(path.join(source, 'fixture.html'), '<p>Public fixture</p>\n');
  await fs.writeFile(path.join(source, 'reference.test.mjs'), 'export {};\n');
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

test('contribution pack accepts an evidence-backed website reference without adapter code', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'web-cap-reference-'));
  const sourceDir = await makeWebsiteReference(root);
  const packed = await packContribution({
    sourceDir,
    outputDir: path.join(root, 'packed')
  });

  assert.equal(packed.contributionKind, 'website-reference');
  assert.equal(packed.capabilityId, 'static-html-list');
  assert.ok(packed.files.some((item) => item.path === 'reference.json'));
  assert.ok(!packed.files.some((item) => item.path === 'adapter.mjs'));
});

test('website reference contribution rejects private network URLs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'web-cap-reference-'));
  const sourceDir = await makeWebsiteReference(root, 'http://127.0.0.1/notices');

  await assert.rejects(
    () => packContribution({ sourceDir, outputDir: path.join(root, 'packed') }),
    /public URL without credentials/
  );
});

test('website reference contribution reports a typed path prefix error', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'web-cap-reference-'));
  const sourceDir = await makeWebsiteReference(root);
  const referencePath = path.join(sourceDir, 'reference.json');
  const reference = JSON.parse(await fs.readFile(referencePath, 'utf8'));
  reference.target.match.pathPrefix = 42;
  await fs.writeFile(referencePath, JSON.stringify(reference));

  await assert.rejects(
    () => packContribution({ sourceDir, outputDir: path.join(root, 'packed') }),
    /pathPrefix must be a string starting with \//
  );
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

test('legacy packs stay local and require evidence; self-reported receipts grant no acceptance', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'web-cap-local-'));
  const sourceDir = await makeCapability(root);
  await fs.writeFile(path.join(sourceDir, 'application-verification.json'), '{"passed":true}');
  const packed = await packContribution({ sourceDir, outputDir: path.join(root, 'out') });
  assert.equal(packed.acceptance.status, 'needs-evidence');
  assert.equal(packed.disclosure.publicReady, false);
  assert.equal(packed.disclosure.status, 'local-only');
});

test('privacy rejection occurs before any output is created and does not echo sensitive values', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'web-cap-private-'));
  const sourceDir = await makeCapability(root);
  await fs.writeFile(path.join(sourceDir, 'fixture.html'), '<p>email: synthetic.person@private.invalid</p>');
  const outputDir = path.join(root, 'out');
  await assert.rejects(() => packContribution({ sourceDir, outputDir }), (error) => {
    assert.match(error.message, /PRIVATE_DATA_DETECTED/);
    assert.equal(error.message.includes('synthetic.person'), false);
    return true;
  });
  await assert.rejects(fs.access(outputDir), { code: 'ENOENT' });
});

test('packing cannot erase the source, an ancestor, or an existing output directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'web-cap-paths-'));
  const sourceDir = await makeCapability(root);
  for (const outputDir of [sourceDir, root, path.join(sourceDir, 'out')]) {
    await assert.rejects(() => packContribution({ sourceDir, outputDir }), /OUTPUT_PATH_UNSAFE/);
    assert.ok(await fs.readFile(path.join(sourceDir, 'fixture.html'), 'utf8'));
  }
  const outputDir = path.join(root, 'existing'); await fs.mkdir(outputDir);
  await fs.writeFile(path.join(outputDir, 'keep.txt'), 'preserve');
  await assert.rejects(() => packContribution({ sourceDir, outputDir }), /OUTPUT_ALREADY_EXISTS/);
  assert.equal(await fs.readFile(path.join(outputDir, 'keep.txt'), 'utf8'), 'preserve');
});

test('exact disclosure review permits publication eligibility but not central verification', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'web-cap-review-'));
  const sourceDir = await makeCapability(root);
  const files = await Promise.all((await fs.readdir(sourceDir)).map(async (name) => ({
    path: name, content: await fs.readFile(path.join(sourceDir, name))
  })));
  const packed = await packContribution({ sourceDir, outputDir: path.join(root, 'out'), publicationReview: {
    schemaVersion: 1, authorization: 'public-contribution', reviewed: true,
    containsPrivateData: false, contentSha256: disclosureDigest(files)
  } });
  assert.equal(packed.disclosure.publicReady, true);
  assert.equal(packed.acceptance.status, 'needs-evidence');
});
