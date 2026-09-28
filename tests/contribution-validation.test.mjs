import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { packContribution, validateContribution } from '../src/index.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'contribution-validation-'));
  const sourceDir = path.join(root, 'source');
  await fs.cp(new URL('../examples/capability-contribution/', import.meta.url), sourceDir, { recursive: true });
  const contract = { schemaVersion: 1, changeType: 'new-capability',
    base: { capabilityId: 'static-html-list', capabilityVersion: '0.1.0', libraryVersion: '0.2.0' },
    targetType: 'static-html', appliesTo: ['Synthetic cards'], notAppliesTo: ['Login pages'],
    conditions: { network: 'offline', governmentDirect: true, login: false, human: false }, dependencies: [],
    entryPoint: { file: 'adapter.mjs', export: 'extractExampleCards', signature: 'input-v1' },
    verification: { command: ['node', '--test', 'adapter.test.mjs'], cases: [{ id: 'new-card',
      fixture: 'fixture.html', operation: 'list', url: 'https://example.test/', baselineExpectation: 'fails',
      expected: { records: [{ title: 'Synthetic record', url: 'https://example.test/1' }], diagnosticCodes: [] } }] }
  };
  await fs.writeFile(path.join(sourceDir, 'contribution.json'), JSON.stringify(contract));
  const packedDir = path.join(root, 'packed');
  await packContribution({ sourceDir, outputDir: packedDir });
  return { root, sourceDir, packedDir, contract };
}
async function rewriteManifest(packedDir, mutate) {
  const name = path.join(packedDir, 'contribution-manifest.json');
  const value = JSON.parse(await fs.readFile(name, 'utf8'));
  await mutate(value);
  await fs.writeFile(name, JSON.stringify(value));
}
async function rehash(packedDir) {
  await rewriteManifest(packedDir, async (manifest) => {
    for (const file of manifest.files) file.sha256 = hash(await fs.readFile(path.join(packedDir, file.path)));
    manifest.packSha256 = hash(JSON.stringify(manifest.files));
  });
}

test('static validation independently accepts intact modern tree but never calls it verified', async () => {
  const { packedDir } = await fixture();
  const result = await validateContribution({ contributionDir: packedDir });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'ready-for-independent-validation');
  assert.equal(result.verifiedContribution, false);
  assert.equal(result.publicReady, false);
  assert.match(result.packSha256, /^[a-f0-9]{64}$/);
});

test('tampered files, added files, missing files and additional directories are rejected', async () => {
  for (const mutation of [
    (d) => fs.appendFile(path.join(d, 'fixture.html'), 'changed'),
    (d) => fs.writeFile(path.join(d, 'extra.txt'), 'undeclared'),
    (d) => fs.unlink(path.join(d, 'fixture.html')),
    (d) => fs.mkdir(path.join(d, 'unused'))
  ]) {
    const { packedDir } = await fixture(); await mutation(packedDir);
    assert.equal((await validateContribution({ contributionDir: packedDir })).status, 'rejected');
  }
});

test('manifest cannot claim external paths, repeated paths, reserved files or fake verified state', async () => {
  for (const mutate of [
    (v) => { v.files[0].path = '../outside.txt'; },
    (v) => { v.files.push(v.files[0]); },
    (v) => { v.files[0].path = 'contribution-manifest.json'; },
    (v) => { v.capabilityId = 'other-capability'; },
    (v) => { v.packSha256 = '0'.repeat(64); }
  ]) {
    const { packedDir } = await fixture(); await rewriteManifest(packedDir, mutate);
    const result = await validateContribution({ contributionDir: packedDir });
    assert.equal(result.status, 'rejected');
    assert.equal(JSON.stringify(result).includes('outside.txt'), false);
  }
  const { packedDir } = await fixture();
  await rewriteManifest(packedDir, (v) => {
    v.acceptance = { status: 'verified', passed: true };
    v.disclosure = { publicReady: true };
  });
  const result = await validateContribution({ contributionDir: packedDir });
  assert.equal(result.verifiedContribution, false);
  assert.equal(result.publicReady, false);
});

test('valid hashes do not excuse private samples or contract/definition disagreement', async () => {
  for (const mutation of [
    (d) => fs.writeFile(path.join(d, 'fixture.html'), 'synthetic.person@private.invalid'),
    async (d) => {
      const p = path.join(d, 'contribution.json'); const c = JSON.parse(await fs.readFile(p, 'utf8'));
      c.entryPoint.file = 'undeclared.mjs'; await fs.writeFile(p, JSON.stringify(c));
    }
  ]) {
    const { packedDir } = await fixture(); await mutation(packedDir); await rehash(packedDir);
    const result = await validateContribution({ contributionDir: packedDir });
    assert.equal(result.status, 'rejected');
    assert.equal(JSON.stringify(result).includes('synthetic.person'), false);
  }
});

test('historical format without new metadata stays needs-evidence', async () => {
  const { sourceDir, root } = await fixture();
  await fs.unlink(path.join(sourceDir, 'contribution.json'));
  const contributionDir = path.join(root, 'legacy');
  await packContribution({ sourceDir, outputDir: contributionDir });
  await rewriteManifest(contributionDir, (v) => { delete v.contributionFormatVersion; delete v.acceptance; delete v.disclosure; });
  const result = await validateContribution({ contributionDir });
  assert.equal(result.status, 'needs-evidence');
  assert.equal(result.verifiedContribution, false);
});

test('root junction cannot disguise an outside contribution tree', async () => {
  const { packedDir, root } = await fixture();
  const link = path.join(root, 'linked');
  await fs.symlink(packedDir, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await validateContribution({ contributionDir: link })).status, 'rejected');
});

test('validation and discovery CLI expose bounded JSON with truthful exit status', async () => {
  const { packedDir } = await fixture();
  const cli = new URL('../bin/web-extract.mjs', import.meta.url);
  const run = (...args) => spawnSync(process.execPath, [fileURLToPath(cli), ...args], { encoding: 'utf8' });
  const intact = run('contribution:validate', '--contribution', packedDir);
  assert.equal(intact.status, 0, intact.stdout);
  assert.equal(JSON.parse(intact.stdout).verifiedContribution, false);
  await fs.appendFile(path.join(packedDir, 'fixture.html'), 'broken');
  const broken = run('contribution:validate', '--contribution', packedDir);
  assert.equal(broken.status, 1);
  assert.equal(JSON.parse(broken.stdout).status, 'rejected');
  const discovery = run('contribution:protocol');
  assert.equal(discovery.status, 0);
  assert.equal(JSON.parse(discovery.stdout).defaultDisclosure, 'local-only');
});
