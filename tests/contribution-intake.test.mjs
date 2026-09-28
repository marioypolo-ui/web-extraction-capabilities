import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { packContribution, receiveContribution, getContributionStatus } from '../src/index.mjs';
import { inspectContributionTree } from '../src/contribution-validation.mjs';

async function fixture(kind = 'capability') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'central-intake-'));
  const sourceDir = path.join(root, 'source');
  await fs.cp(new URL(`../examples/${kind === 'capability' ? 'capability' : 'website-reference'}-contribution/`, import.meta.url), sourceDir, { recursive: true });
  const contributionDir = path.join(root, 'pack');
  await packContribution({ sourceDir, outputDir: contributionDir });
  const snapshot = await inspectContributionTree({ contributionDir });
  const publicationReview = { schemaVersion: 1, authorization: 'public-contribution',
    reviewed: true, containsPrivateData: false, contentSha256: snapshot.disclosure.contentSha256 };
  return { root, sourceDir, contributionDir, publicationReview, storeDir: path.join(root, 'intake') };
}

test('local intake deduplicates repeated packs without marking legacy evidence verified', async () => {
  const options = await fixture();
  const first = await receiveContribution(options);
  assert.equal(first.ok, true);
  assert.equal(first.receiptVersion, 1);
  assert.equal(first.duplicate, false);
  const again = await receiveContribution(options);
  assert.equal(again.duplicate, true);
  assert.equal(again.contributionKey, first.contributionKey);
  const status = await getContributionStatus({ storeDir: options.storeDir, contributionKey: first.contributionKey });
  assert.equal(status.events.length, 1);
  assert.equal(status.receiptVersion, 1);
  assert.equal(status.events[0].receipt.status, 'needs-evidence');
  assert.equal(status.verifiedContribution, false);
  assert.equal(status.mergeStatus, 'not-recorded');
  assert.equal(status.releaseStatus, 'not-recorded');
  const archive = path.join(options.storeDir, 'objects', status.events[0].packSha256);
  assert.equal((await inspectContributionTree({ contributionDir: archive })).manifest.packSha256, status.events[0].packSha256);
  assert.equal(await fs.readFile(path.join(archive, 'adapter.mjs'), 'utf8'),
    await fs.readFile(path.join(options.contributionDir, 'adapter.mjs'), 'utf8'));
});

test('supplemented bytes preserve old evidence under the same capability identity', async () => {
  const options = await fixture();
  const first = await receiveContribution(options);
  await fs.writeFile(path.join(options.sourceDir, 'additional-evidence.txt'), 'Synthetic added evidence.');
  const contributionDir = path.join(options.root, 'second-pack');
  await packContribution({ sourceDir: options.sourceDir, outputDir: contributionDir });
  const snapshot = await inspectContributionTree({ contributionDir });
  const second = await receiveContribution({ ...options, contributionDir,
    publicationReview: { ...options.publicationReview, contentSha256: snapshot.disclosure.contentSha256 } });
  assert.equal(second.contributionKey, first.contributionKey);
  const status = await getContributionStatus({ storeDir: options.storeDir, contributionKey: first.contributionKey });
  assert.equal(status.events.length, 2);
  assert.equal(new Set(status.events.map((e) => e.packSha256)).size, 2);
  assert.equal(status.verifiedContribution, false);
});

test('website reference grouping follows existing host/path matching identity', async () => {
  const options = await fixture('reference');
  const first = await receiveContribution(options);
  const name = path.join(options.sourceDir, 'reference.json');
  const reference = JSON.parse(await fs.readFile(name, 'utf8'));
  reference.target.name = 'Another synthetic name';
  reference.target.match.host = reference.target.match.host.toUpperCase();
  await fs.writeFile(name, JSON.stringify(reference));
  const contributionDir = path.join(options.root, 'renamed-pack');
  await packContribution({ sourceDir: options.sourceDir, outputDir: contributionDir });
  const snapshot = await inspectContributionTree({ contributionDir });
  const second = await receiveContribution({ ...options, contributionDir,
    publicationReview: { ...options.publicationReview, contentSha256: snapshot.disclosure.contentSha256 } });
  assert.equal(second.contributionKey, first.contributionKey);
});

test('no disclosure authorization means no intake writes, and unsafe query keys are rejected', async () => {
  const options = await fixture();
  const result = await receiveContribution({ ...options, publicationReview: undefined });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'needs-disclosure-review');
  assert.equal(result.receiptVersion, 1);
  await assert.rejects(fs.stat(options.storeDir), { code: 'ENOENT' });
  const query = await getContributionStatus({ storeDir: options.storeDir, contributionKey: '../SYNTHETIC_PRIVATE_MARKER' });
  assert.equal(query.ok, false);
  assert.equal(query.receiptVersion, 1);
  assert.equal(JSON.stringify(query).includes('SYNTHETIC_PRIVATE_MARKER'), false);
});

test('tampered evidence fails closed and existing writer locks are not removed', async () => {
  const options = await fixture();
  const received = await receiveContribution(options);
  const query = { storeDir: options.storeDir, contributionKey: received.contributionKey };
  const lock = path.join(options.storeDir, '.intake-lock');
  await fs.mkdir(lock);
  assert.equal((await getContributionStatus(query)).status, 'blocked');
  assert.equal((await receiveContribution(options)).status, 'blocked');
  assert.equal((await fs.stat(lock)).isDirectory(), true);
  await fs.rmdir(lock);
  const file = path.join(options.storeDir, received.contributionKey, `${received.eventId}.json`);
  await fs.appendFile(file, 'SYNTHETIC_PRIVATE_MARKER');
  const result = await getContributionStatus(query);
  assert.deepEqual(result.reasons, ['INTAKE_EVENT_HASH_MISMATCH']);
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE_MARKER'), false);
  assert.equal((await fs.readFile(file, 'utf8')).endsWith('SYNTHETIC_PRIVATE_MARKER'), true);
});

test('store junctions and store-inside-pack paths cannot redirect intake writes', async () => {
  const options = await fixture();
  const outside = path.join(options.root, 'outside');
  await fs.mkdir(outside);
  await fs.symlink(outside, options.storeDir, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await receiveContribution({ ...options, storeDir: path.join(options.storeDir, 'nested') })).ok, false);
  assert.deepEqual(await fs.readdir(outside), []);
  assert.equal((await receiveContribution({ ...options, storeDir: path.join(options.contributionDir, 'intake') })).ok, false);
});
