import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inspectContributionTree } from './contribution-validation.mjs';
import { verifyContribution } from './contribution-verification.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const hex = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fail = (reason) => { throw new Error(reason); };
const errorReceipt = (error) => ({ receiptVersion: 1, ok: false, status: 'rejected', verifiedContribution: false,
  reasons: [/^[A-Z][A-Z0-9_]{0,79}$/.test(error?.message || '') ? error.message : 'INTAKE_STORAGE_FAILED'] });
const STATUSES = new Set(['needs-evidence', 'blocked', 'rejected', 'needs-disclosure-review', 'verified']);

// Only controller-owned fields enter the ledger. No external receipt-import API.
function projectReceipt(receipt) {
  if (!STATUSES.has(receipt?.status) || !Array.isArray(receipt.reasons) ||
    receipt.reasons.some((s) => typeof s !== 'string' || !/^[A-Z][A-Z0-9_]{0,79}$/.test(s))) fail('INTAKE_EVENT_INVALID');
  return { ok: receipt.ok === true, status: receipt.status, reasons: receipt.reasons,
    verifiedContribution: receipt.status === 'verified' && receipt.verifiedContribution === true,
    publicReady: receipt.publicReady === true, reusable: false };
}

function projectEvidence(value = {}) {
  const cases = value.cases ?? [];
  if (!Array.isArray(cases) || cases.length > 100) fail('INTAKE_EVENT_INVALID');
  const checks = (items) => {
    if (!Array.isArray(items) || items.length > 5000) fail('INTAKE_EVENT_INVALID');
    return items.map((item) => {
      if (typeof item?.field !== 'string' || !/^(result-shape|case-shape|diagnostics|records-shape|record-count|record-\d+|empty-diagnostic|document)$/.test(item.field) ||
        typeof item.passed !== 'boolean') fail('INTAKE_EVENT_INVALID');
      return { field: item.field, passed: item.passed };
    });
  };
  return { cases: cases.map((item) => {
    if (!Number.isInteger(item?.index) || item.index < 0 || item.index > 99 ||
      typeof item.baselineMatched !== 'boolean' || typeof item.candidatePassed !== 'boolean') fail('INTAKE_EVENT_INVALID');
    return { index: item.index, baselineMatched: item.baselineMatched, candidatePassed: item.candidatePassed,
      baselineChecks: checks(item.baselineChecks), candidateChecks: checks(item.candidateChecks) };
  }) };
}

async function directory(target, create = false) {
  const absolute = path.resolve(target);
  // Reject junctions/symlinks in every existing component, including the store's
  // parents. The maintenance-owned store must not be inside a submitted pack.
  let current = absolute;
  while (true) {
    try {
      const stat = await fs.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail('INTAKE_PATH_INVALID');
    } catch (error) { if (!create || error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (create) {
    await fs.mkdir(absolute, { recursive: true });
    return directory(absolute);
  }
  return absolute;
}

async function readEvents(root, contributionKey) {
  const target = path.join(root, contributionKey);
  try { await directory(target); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const names = await fs.readdir(target);
  if (names.length > 1000) fail('INTAKE_HISTORY_LIMIT');
  const events = [];
  for (const name of names.sort()) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) fail('INTAKE_EVENT_INVALID');
    const filename = path.join(target, name);
    const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 65536) fail('INTAKE_EVENT_INVALID');
    const bytes = await fs.readFile(filename);
    if (`${hash(bytes)}.json` !== name) fail('INTAKE_EVENT_HASH_MISMATCH');
    const event = JSON.parse(bytes);
    if (event.storeVersion !== 1 || event.contributionKey !== contributionKey || !hex(event.packSha256) ||
      !hex(event.contextKey) || !hex(event.verificationDigest)) fail('INTAKE_EVENT_INVALID');
    events.push({ eventId: name.slice(0, -5), contributionKey, packSha256: event.packSha256,
      contextKey: event.contextKey, verificationDigest: event.verificationDigest,
      receipt: projectReceipt(event.receipt), evidence: projectEvidence(event.evidence) });
  }
  return events;
}

async function canonicalDestination(value) {
  let current = path.resolve(value);
  const suffix = [];
  while (true) {
    try {
      await fs.lstat(current);
      await directory(current);
      return path.join(await fs.realpath(current), ...suffix);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
}

function keyFor(snapshot) {
  const identity = [snapshot.manifest.contributionKind, snapshot.manifest.capabilityId];
  if (snapshot.reference) identity.push(snapshot.reference.target.match.host.toLowerCase(),
    (snapshot.reference.target.match.pathPrefix || '/').toLowerCase());
  return hash(JSON.stringify(identity));
}

export async function receiveContribution(options = {}) {
  let lock;
  try {
    const snapshot = await inspectContributionTree(options);
    if (!snapshot.disclosure.publicReady) return { receiptVersion: 1, ok: false, status: 'needs-disclosure-review',
      reasons: ['PUBLICATION_REVIEW_REQUIRED'], verifiedContribution: false };
    if (typeof options.storeDir !== 'string' || !options.storeDir) fail('INTAKE_STORE_REQUIRED');
    const input = await fs.realpath(options.contributionDir);
    const store = await canonicalDestination(options.storeDir);
    const relative = path.relative(input, store);
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) fail('INTAKE_PATH_INVALID');
    const root = await directory(store, true);
    const lockPath = path.join(root, '.intake-lock');
    try { await fs.mkdir(lockPath); lock = lockPath; }
    catch (error) { if (error.code === 'EEXIST') return { receiptVersion: 1, ok: false, status: 'blocked',
      reasons: ['INTAKE_BUSY'], verifiedContribution: false }; throw error; }
    const contributionKey = keyFor(snapshot);
    const events = await readEvents(root, contributionKey);
    // Retain the exact validated source bytes as local evidence. A mutable source
    // directory outside the store must not invalidate historical provenance.
    const objects = await directory(path.join(root, 'objects'), true);
    const archived = path.join(objects, snapshot.manifest.packSha256);
    let exists = false;
    try { await fs.lstat(archived); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!exists) {
      await directory(archived, true);
      for (const file of [...snapshot.files, { path: 'contribution-manifest.json',
        content: Buffer.from(JSON.stringify(snapshot.manifest)) }]) {
        const destination = path.join(archived, ...file.path.split('/'));
        await directory(path.dirname(destination), true);
        await fs.writeFile(destination, file.content, { flag: 'wx', mode: 0o600 });
      }
    }
    const retained = await inspectContributionTree({ contributionDir: archived, publicationReview: options.publicationReview });
    if (retained.manifest.packSha256 !== snapshot.manifest.packSha256) fail('INTAKE_ARCHIVE_MISMATCH');
    // Always re-run actual validation on retries. An imported passed field or a
    // previous local success never suppresses current independent verification.
    const verification = await verifyContribution({ ...options, contributionDir: archived });
    if (verification.packSha256 !== snapshot.manifest.packSha256) fail('CONTRIBUTION_CHANGED_DURING_INTAKE');
    const contextKey = hash(JSON.stringify([options.baseline?.bundleSha256 ?? null,
      options.baseline?.manifestSha256 ?? null, options.image ?? null, snapshot.disclosure.contentSha256]));
    const event = { storeVersion: 1, contributionKey, packSha256: snapshot.manifest.packSha256,
      contextKey, verificationDigest: hash(JSON.stringify(verification)), receipt: projectReceipt(verification),
      evidence: projectEvidence(verification) };
    const bytes = JSON.stringify(event);
    if (Buffer.byteLength(bytes) > 65536) fail('INTAKE_EVENT_SIZE_LIMIT');
    const eventId = hash(bytes);
    const duplicate = events.some((e) => e.eventId === eventId);
    if (!duplicate) {
      if (events.length >= 1000) fail('INTAKE_HISTORY_LIMIT');
      const target = await directory(path.join(root, contributionKey), true);
      await fs.writeFile(path.join(target, `${eventId}.json`), bytes, { flag: 'wx', mode: 0o600 });
    }
    return { receiptVersion: 1, ok: true, status: 'received', contributionKey, eventId, duplicate,
      verification: event.receipt, verifiedContribution: false, reusable: false };
  } catch (error) { return errorReceipt(error); }
  finally { if (lock) { try { await fs.rmdir(lock); } catch { return errorReceipt(new Error('INTAKE_LOCK_RELEASE_FAILED')); } } }
}

export async function getContributionStatus({ storeDir, contributionKey } = {}) {
  let lock;
  try {
    if (!hex(contributionKey)) fail('CONTRIBUTION_KEY_INVALID');
    if (typeof storeDir !== 'string' || !storeDir) fail('INTAKE_STORE_REQUIRED');
    const root = await directory(storeDir);
    // Readers do not observe partially written events while a writer owns the lock.
    const lockPath = path.join(root, '.intake-lock');
    try { await fs.mkdir(lockPath); lock = lockPath; }
    catch (error) { if (error.code === 'EEXIST') return { receiptVersion: 1, ok: false, status: 'blocked', verifiedContribution: false, reasons: ['INTAKE_BUSY'] }; throw error; }
    const events = await readEvents(root, contributionKey);
    return { receiptVersion: 1, ok: true, status: events.length ? 'recorded' : 'not-found', contributionKey, events,
      verifiedContribution: false, reusable: false, mergeStatus: 'not-recorded', releaseStatus: 'not-recorded' };
  } catch (error) { return errorReceipt(error); }
  finally { if (lock) { try { await fs.rmdir(lock); } catch { return errorReceipt(new Error('INTAKE_LOCK_RELEASE_FAILED')); } } }
}
