import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inspectContributionTree } from './contribution-validation.mjs';
import { validateBundle } from './bundle-validation.mjs';
import { runIsolatedNode } from './contribution-isolation.mjs';
import { compareContributionResult } from './contribution-comparison.mjs';
import { isBoundedPlainJson } from './problem-feedback.mjs';
import { classifyProblem } from './problem-classification.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hex = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = (code) => { throw new Error(code); };
const safeReason = (error) => /^[A-Z][A-Z0-9_]{0,79}$/.test(error?.message || '') ? error.message : 'INDEPENDENT_VERIFICATION_FAILED';
const parsingEvidence = (codes) => classifyProblem({ diagnosticCodes: codes,
  reproduction: { ok: true, status: 'reproduced', checks: [{ passed: false }] }
}).category === 'reproduced-capability-gap';
const parse = (text) => {
  const value = JSON.parse(text);
  if (!isBoundedPlainJson(value, 16)) fail('ISOLATED_RESULT_INVALID');
  return value;
};

async function writeSnapshot(directory, files) {
  await fs.mkdir(directory, { recursive: true, mode: 0o755 });
  for (const file of files) {
    const destination = path.join(directory, ...file.path.split('/'));
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o755 });
    await fs.writeFile(destination, file.content, { flag: 'wx', mode: 0o644 });
  }
}

// The baseline location and BOTH pins come from the trusted maintenance caller,
// not contribution metadata. No baseline module is imported on the host.
async function stageBaseline(baseline, version, destination) {
  const root = path.resolve(baseline.bundleDir);
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('BASELINE_INVALID');
  const read = async (relative) => {
    const parts = relative.split('/');
    let current = root;
    for (const part of parts) {
      current = path.join(current, part);
      if ((await fs.lstat(current)).isSymbolicLink()) fail('BASELINE_INVALID');
    }
    const handle = await fs.open(current, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 8 * 1024 * 1024) fail('BASELINE_INVALID');
      const buffer = Buffer.alloc(stat.size + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length !== stat.size) fail('BASELINE_CHANGED');
      return buffer.subarray(0, length);
    } finally { await handle.close(); }
  };
  const raw = await read('bundle-manifest.json');
  if (hash(raw) !== baseline.manifestSha256) fail('BASELINE_PIN_MISMATCH');
  const manifest = parse(raw.toString('utf8'));
  if (manifest.bundleSha256 !== baseline.bundleSha256 || manifest.version !== version ||
    !Array.isArray(manifest.files) || manifest.files.length > 1000) fail('BASELINE_PIN_MISMATCH');
  const files = [{ path: 'bundle-manifest.json', content: raw }];
  let total = raw.length;
  const names = new Set(['bundle-manifest.json']);
  for (const entry of manifest.files) {
    if (typeof entry?.path !== 'string' || !entry.path.split('/').every((p) =>
      /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(p) && !p.endsWith('.') &&
      !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)) ||
      names.has(entry.path.toLowerCase()) || !hex(entry.sha256)) fail('BASELINE_INVALID');
    names.add(entry.path.toLowerCase());
    const content = await read(entry.path);
    if ((total += content.length) > 32 * 1024 * 1024) fail('BASELINE_INVALID');
    if (hash(content) !== entry.sha256) fail('BASELINE_PIN_MISMATCH');
    files.push({ path: entry.path, content });
  }
  await writeSnapshot(destination, files);
  return validateBundle({ bundleDir: destination, expectedVersion: version });
}

export async function verifyContribution({ contributionDir, publicationReview, baseline, image } = {}) {
  let snapshot;
  try { snapshot = await inspectContributionTree({ contributionDir, publicationReview }); }
  catch (error) { return { receiptVersion: 1, ok: false, status: 'rejected', reasons: [safeReason(error)],
    publicReady: false, verifiedContribution: false, reusable: false }; }
  const receipt = { ...snapshot.receipt, cases: [], reusable: false };
  const stop = (status, reason) => ({ ...receipt, ok: false, status, reasons: [reason], verifiedContribution: false });
  if (!receipt.ok) return receipt;
  if (!baseline || typeof baseline.bundleDir !== 'string' || !baseline.bundleDir ||
    !hex(baseline.bundleSha256) || !hex(baseline.manifestSha256)) return stop('blocked', 'PINNED_BASELINE_REQUIRED');
  if (typeof image !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(image)) return stop('blocked', 'PINNED_LOCAL_IMAGE_REQUIRED');
  const { metadata, files } = snapshot;
  let root;
  try {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'central-contribution-verification-'));
    // Deliberate staging only; no repository, credentials, host tmp or Docker socket
    // is mounted. Per-mount roots must be traversable by the container's non-root UID.
    const baselineDir = path.join(root, 'baseline');
    const candidateDir = path.join(root, 'candidate');
    const runnerDir = path.join(root, 'runner');
    const manifest = await stageBaseline(baseline, metadata.base.libraryVersion, baselineDir);
    if (!manifest.capabilities.some((c) => c.id === metadata.base.capabilityId &&
      c.version === metadata.base.capabilityVersion)) return stop('rejected', 'BASELINE_CAPABILITY_MISMATCH');
    receipt.baselineSha256 = baseline.bundleSha256;
    receipt.baselineManifestSha256 = baseline.manifestSha256;
    receipt.runnerImage = image;
    await writeSnapshot(runnerDir, await Promise.all(['contribution-case.mjs', 'contribution-tests.mjs'].map(async (name) =>
      ({ path: name, content: await fs.readFile(new URL(`./runners/${name}`, import.meta.url)) }))));
    // Keep expectation metadata out of the extraction process. Tests and other
    // contribution files are mounted only for the separate supplementary test run.
    const excluded = new Set(['contribution.json', 'capability.json', 'reference.json', 'application-verification.json',
      ...metadata.verification.command.slice(2), ...metadata.verification.cases.map((item) => item.fixture)]);
    await writeSnapshot(candidateDir, files.filter((file) => !excluded.has(file.path) && !file.path.endsWith('.test.mjs')));
    const execute = (mounts, args, input = '') => runIsolatedNode({ image,
      mounts: [{ source: runnerDir, target: '/runner' }, ...mounts], args, input });
    const byPath = new Map(files.map((f) => [f.path, f.content]));
    for (const [index, item] of metadata.verification.cases.entries()) {
      const fixture = byPath.get(item.fixture).toString('utf8');
      if (!parsingEvidence(item.expected.diagnosticCodes)) return stop('needs-evidence', 'NON_PARSING_EXPECTATION');
      const input = { url: item.url, capabilityId: metadata.base.capabilityId, config: item.config ?? {},
        ...(item.fixture.endsWith('.html') ? { html: fixture } : { json: parse(fixture) }) };
      const serialized = JSON.stringify(input);
      const before = await execute([{ source: baselineDir, target: '/baseline' }],
        ['/runner/contribution-case.mjs', 'baseline', item.operation], serialized);
      if (!before.ok) return stop(before.status, before.reason);
      const baselineResult = parse(before.stdout);
      const beforeCheck = compareContributionResult(item, baselineResult);
      // Malformed outputs, network/application failures and crashes do not prove a
      // reproducible parsing gap even if they differ from expected records.
      if (beforeCheck.checks.some((c) => ['result-shape', 'records-shape', 'empty-diagnostic'].includes(c.field) && !c.passed) ||
        (item.operation === 'detail' && (!Object.hasOwn(baselineResult, 'document') ||
          (baselineResult.document !== null && (typeof baselineResult.document !== 'object' || Array.isArray(baselineResult.document))))) ||
        !parsingEvidence(baselineResult.diagnostics.map((d) => d.code))) {
        return stop('needs-evidence', 'BASELINE_NOT_PARSING_EVIDENCE');
      }
      let afterCheck = beforeCheck;
      if (metadata.changeType !== 'website-reference') {
        const after = await execute([{ source: candidateDir, target: '/candidate' }],
          ['/runner/contribution-case.mjs', 'candidate', item.operation, metadata.entryPoint.file, metadata.entryPoint.export], serialized);
        if (!after.ok) return stop(after.status, after.reason);
        afterCheck = compareContributionResult(item, parse(after.stdout));
      }
      const baselineMatched = beforeCheck.passed === (item.baselineExpectation === 'passes');
      receipt.cases.push({ index, baselineMatched, candidatePassed: afterCheck.passed,
        baselineChecks: beforeCheck.checks, candidateChecks: afterCheck.checks });
      if (!baselineMatched || !afterCheck.passed) return stop('rejected', 'INDEPENDENT_COMPARISON_FAILED');
    }
    const testDir = path.join(root, 'tests');
    await writeSnapshot(testDir, files);
    const tests = await execute([{ source: testDir, target: '/candidate' }],
      ['/runner/contribution-tests.mjs', '--candidate-root', ...metadata.verification.command.slice(2)]);
    if (!tests.ok) return stop(tests.status, tests.reason);
    const evidence = parse(tests.stdout);
    const numbers = ['tests', 'passed', 'failed', 'skipped', 'todo', 'cancelled'];
    if (!evidence?.ok || !numbers.every((k) => Number.isSafeInteger(evidence[k]) && evidence[k] >= 0) ||
      evidence.tests === 0 || evidence.passed !== evidence.tests ||
      ['failed', 'skipped', 'todo', 'cancelled'].some((k) => evidence[k] !== 0)) return stop('rejected', 'CONTRIBUTION_TESTS_FAILED');
    receipt.tests = Object.fromEntries(numbers.map((k) => [k, evidence[k]]));
    if (!receipt.publicReady) return stop('needs-disclosure-review', 'PUBLICATION_REVIEW_REQUIRED');
    return { ...receipt, ok: true, status: 'verified', reasons: [], verifiedContribution: true,
      integrationStatus: 'pending-review' };
  } catch (error) {
    return stop('rejected', safeReason(error));
  }
  // Staged evidence is deliberately retained locally for diagnosis. It is never
  // uploaded and does not authorize changing catalog support or application adoption.
}
