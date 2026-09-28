import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { extract, packContribution, validateContribution, validateContributionContract, CONTRIBUTION_PROTOCOL } from '../src/index.mjs';
import { compareContributionResult } from '../src/contribution-comparison.mjs';
import { extractCards } from '../examples/verified-capability-contribution/adapter.mjs';

const source = new URL('../examples/verified-capability-contribution/', import.meta.url);
test('modern website reference uses the existing implementation without inventing a capability', async () => {
  const referenceSource = new URL('../examples/verified-website-reference-contribution/', import.meta.url);
  const metadata = JSON.parse(await fs.readFile(new URL('contribution.json', referenceSource), 'utf8'));
  assert.equal(validateContributionContract(metadata).ok, true);
  const item = metadata.verification.cases[0];
  const result = await extract({ url: item.url, capabilityId: metadata.base.capabilityId,
    html: await fs.readFile(new URL(item.fixture, referenceSource), 'utf8') });
  assert.equal(compareContributionResult(item, result).passed, true);
  const { fileURLToPath } = await import('node:url');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'modern-reference-example-'));
  await packContribution({ sourceDir: fileURLToPath(referenceSource), outputDir: path.join(root, 'pack') });
  assert.equal((await validateContribution({ contributionDir: path.join(root, 'pack') })).ok, true);
});
test('modern synthetic example has real before/after, regression and empty-input evidence', async () => {
  const metadata = JSON.parse(await fs.readFile(new URL('contribution.json', source), 'utf8'));
  assert.equal(validateContributionContract(metadata).ok, true);
  // Only repository-authored synthetic code is run here. This does not replace
  // pinned Release replay or isolation acceptance for an external submission.
  for (const item of metadata.verification.cases) {
    const input = { url: item.url, capabilityId: metadata.base.capabilityId,
      html: await fs.readFile(new URL(item.fixture, source), 'utf8') };
    assert.equal(compareContributionResult(item, await extract(input)).passed, item.baselineExpectation === 'passes');
    assert.equal(compareContributionResult(item, extractCards(input)).passed, true);
    const broken = extractCards(input);
    if (broken.records.length) {
      broken.records[0].title = 'Wrong synthetic title';
      assert.equal(compareContributionResult(item, broken).passed, false);
    }
  }
  const { fileURLToPath } = await import('node:url');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'modern-contribution-example-'));
  await packContribution({ sourceDir: fileURLToPath(source), outputDir: path.join(root, 'pack') });
  const checked = await validateContribution({ contributionDir: path.join(root, 'pack') });
  assert.equal(checked.ok, true);
  assert.equal(checked.publicReady, false);
  assert.equal(checked.verifiedContribution, false);
});

test('discovered schemas are valid JSON with resolvable local references', async () => {
  async function inspect(file, seen = new Set()) {
    if (seen.has(file)) return;
    seen.add(file);
    const schema = JSON.parse(await fs.readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
    async function walk(value) {
      if (!value || typeof value !== 'object') return;
      if (value.pattern) new RegExp(value.pattern);
      if (value.$ref) {
        const [external, pointer] = value.$ref.split('#');
        const targetFile = external ? path.posix.join(path.posix.dirname(file), external) : file;
        const target = JSON.parse(await fs.readFile(new URL(`../${targetFile}`, import.meta.url), 'utf8'));
        let node = target;
        for (const segment of (pointer || '').split('/').slice(1)) node = node?.[segment.replaceAll('~1', '/').replaceAll('~0', '~')];
        assert.notEqual(node, undefined);
        if (external) await inspect(targetFile, seen);
      }
      for (const child of Object.values(value)) await walk(child);
    }
    await walk(schema);
  }
  await inspect(CONTRIBUTION_PROTOCOL.contractSchema);
  await inspect(CONTRIBUTION_PROTOCOL.disclosureSchema);
  await inspect(CONTRIBUTION_PROTOCOL.receiptSchema);
  await inspect(CONTRIBUTION_PROTOCOL.publicationSchema);
});
