import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectContributionTree } from '../src/contribution-validation.mjs';
import { evaluatePublicationEvidence } from '../src/contribution-publication.mjs';
import { getContributionPublicationStatus, prepareContributionIntegration, packContribution, receiveContribution } from '../src/index.mjs';

const binding = { contributionKey: 'a'.repeat(64), packSha256: 'b'.repeat(64), eventId: 'c'.repeat(64), verificationDigest: 'd'.repeat(64) };
const record = { schemaVersion: 1, ...binding };
const pullRequest = { number: 42, state: 'closed', merged: true, merged_at: '2026-09-27T00:00:00Z',
  merge_commit_sha: 'e'.repeat(40), base: { repo: { full_name: 'marioypolo-ui/web-extraction-capabilities' } } };
const evidence = () => ({ binding, pullRequest, recordAtMerge: record, recordAtRelease: record,
  releaseCommit: 'f'.repeat(40),
  releaseTag: 'v0.3.0', release: { tag_name: 'v0.3.0', draft: false, prerelease: false, published_at: '2026-09-27T00:00:00Z' },
  comparison: { status: 'ahead', base_commit: { sha: pullRequest.merge_commit_sha } } });

test('integrated synthetic example matches its real isolated intake binding', async () => {
  const accepted = JSON.parse(await fs.readFile(new URL('../contributions/accepted/1e413bfd45c98a2f1c73cd12bb5397a04140abb91276532c4c370dafdfc11f14.json', import.meta.url), 'utf8'));
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'central-integrated-example-'));
  await packContribution({ sourceDir: fileURLToPath(new URL('../examples/verified-capability-contribution/', import.meta.url)), outputDir: path.join(temp, 'pack') });
  const manifest = JSON.parse(await fs.readFile(path.join(temp, 'pack', 'contribution-manifest.json'), 'utf8'));
  assert.equal(manifest.packSha256, accepted.packSha256);
  assert.equal(accepted.schemaVersion, 1);
  for (const key of ['contributionKey', 'packSha256', 'eventId', 'verificationDigest']) assert.match(accepted[key], /^[a-f0-9]{64}$/);
});

// These exercise the pure evidence rules only. They do not claim a GitHub fetch,
// actual merge, real isolated acceptance, or Release publication occurred.
test('publication rules require exact contribution binding and release ancestry', () => {
  const result = evaluatePublicationEvidence(evidence());
  assert.equal(result.mergeStatus, 'merged');
  assert.equal(result.releaseStatus, 'published');
  assert.equal(result.reusable, false); assert.equal(result.adopted, false);
  for (const mutate of [
    (v) => { v.recordAtMerge = { ...record, packSha256: 'f'.repeat(64) }; },
    (v) => { v.recordAtRelease = { ...record, eventId: 'f'.repeat(64) }; },
    (v) => { v.comparison = { status: 'behind', base_commit: { sha: pullRequest.merge_commit_sha } }; },
    (v) => { v.comparison.base_commit.sha = 'f'.repeat(40); },
    (v) => { v.release.prerelease = true; },
    (v) => { v.release.draft = true; },
    (v) => { v.release.tag_name = 'v9.0.0'; },
    (v) => { v.pullRequest.base.repo.full_name = 'unrelated/repository'; }
  ]) {
    const value = structuredClone(evidence()); mutate(value);
    const rejected = evaluatePublicationEvidence(value);
    assert.equal(rejected.ok, false); assert.notEqual(rejected.releaseStatus, 'published');
  }
});

test('closed and open PRs never imply a merged contribution', () => {
  const value = evidence();
  for (const [state, expected] of [['open', 'pending'], ['closed', 'closed-unmerged']]) {
    const result = evaluatePublicationEvidence({ ...value, pullRequest: { ...pullRequest, state, merged: false } });
    assert.equal(result.mergeStatus, expected);
    assert.equal(result.releaseStatus, 'not-applicable');
  }
});

test('public API cannot import self-reported verification or arbitrary endpoints', async () => {
  const invalid = await getContributionPublicationStatus({ pullRequestNumber: 1, releaseTag: '../SYNTHETIC_PRIVATE_MARKER',
    verifiedContribution: true, endpoint: 'https://example.test/' });
  assert.equal(invalid.ok, false);
  assert.deepEqual(invalid.reasons, ['PUBLICATION_QUERY_INVALID']);
  assert.equal(JSON.stringify(invalid).includes('SYNTHETIC_PRIVATE_MARKER'), false);
  const absent = await prepareContributionIntegration({ contributionKey: 'bad', eventId: 'bad', verifiedContribution: true });
  assert.equal(absent.ok, false);
  assert.deepEqual(absent.reasons, ['PUBLICATION_BINDING_INVALID']);
});

test('a real stored legacy event cannot generate integration evidence or trigger publication lookup', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'publication-legacy-'));
  const contributionDir = path.join(root, 'pack');
  const storeDir = path.join(root, 'store');
  await packContribution({ sourceDir: fileURLToPath(new URL('../examples/capability-contribution/', import.meta.url)), outputDir: contributionDir });
  const snapshot = await inspectContributionTree({ contributionDir });
  const received = await receiveContribution({ contributionDir, storeDir, publicationReview: {
    schemaVersion: 1, authorization: 'public-contribution', reviewed: true, containsPrivateData: false,
    contentSha256: snapshot.disclosure.contentSha256 } });
  const input = { storeDir, contributionKey: received.contributionKey, eventId: received.eventId };
  assert.deepEqual((await prepareContributionIntegration(input)).reasons, ['LOCAL_VERIFIED_CONTRIBUTION_REQUIRED']);
  assert.deepEqual((await getContributionPublicationStatus({ ...input, pullRequestNumber: 3, releaseTag: 'v0.2.0' })).reasons,
    ['LOCAL_VERIFIED_CONTRIBUTION_REQUIRED']);
});
