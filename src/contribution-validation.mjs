import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateCapabilityManifest, validateVerifiedTarget } from './capability-contract.mjs';
import { safeContributionPath, validateContributionContract } from './contribution-contract.mjs';
import { reviewContributionDisclosure } from './contribution-privacy.mjs';
import { isBoundedPlainJson } from './problem-feedback.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const hex = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const MANIFEST = 'contribution-manifest.json';
const forbidden = new Set(['node_modules', 'package.json', 'package-lock.json', 'npm-shrinkwrap.json']);
const fail = (code) => { throw new Error(code); };
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

async function snapshotTree(root) {
  if (!(await fs.lstat(root)).isDirectory() || (await fs.lstat(root)).isSymbolicLink()) fail('CONTRIBUTION_ROOT_INVALID');
  root = await fs.realpath(root);
  const files = []; const directories = new Set();
  let total = 0; let entriesSeen = 0;
  async function walk(current, depth = 0) {
    if (depth > 12) fail('CONTRIBUTION_SIZE_LIMIT');
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (++entriesSeen > 400) fail('CONTRIBUTION_SIZE_LIMIT');
      const full = path.join(current, entry.name);
      const relative = path.relative(root, full).replaceAll('\\', '/');
      if (!safeContributionPath(relative) || relative.split('/').some((s) => forbidden.has(s))) fail('CONTRIBUTION_PATH_INVALID');
      const stat = await fs.lstat(full);
      if (stat.isSymbolicLink()) fail('CONTRIBUTION_LINK_FORBIDDEN');
      if (stat.isDirectory()) { directories.add(relative); await walk(full, depth + 1); continue; }
      if (!stat.isFile() || stat.nlink !== 1) fail('CONTRIBUTION_FILE_INVALID');
      if (stat.size > 1024 * 1024 || (total += stat.size) > 6 * 1024 * 1024 || files.length >= 201) fail('CONTRIBUTION_SIZE_LIMIT');
      const handle = await fs.open(full, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      try {
        const opened = await handle.stat();
        if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev || opened.size !== stat.size) fail('CONTRIBUTION_CHANGED_DURING_READ');
        const content = Buffer.alloc(stat.size + 1);
        let length = 0;
        while (length < content.length) {
          const { bytesRead } = await handle.read(content, length, content.length - length, length);
          if (!bytesRead) break;
          length += bytesRead;
        }
        if (length !== stat.size) fail('CONTRIBUTION_CHANGED_DURING_READ');
        files.push({ path: relative, content: content.subarray(0, length) });
      } finally { await handle.close(); }
    }
  }
  await walk(root);
  return { files, directories };
}

function parse(file, code) {
  try {
    const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(file.content));
    if (!isBoundedPlainJson(result, 16)) fail(code);
    return result;
  } catch { fail(code); }
}

// Private working snapshot for the trusted independent runner. Do not print or
// persist its content in receipts/artifacts; public API below returns only metadata.
export async function inspectContributionTree({ contributionDir, publicationReview } = {}) {
  if (typeof contributionDir !== 'string' || !contributionDir) fail('CONTRIBUTION_ROOT_INVALID');
  const tree = await snapshotTree(contributionDir);
  const byPath = new Map(tree.files.map((file) => [file.path, file]));
  if (!byPath.has(MANIFEST)) fail('CONTRIBUTION_MANIFEST_REQUIRED');
  const manifest = parse(byPath.get(MANIFEST), 'CONTRIBUTION_MANIFEST_INVALID');
  if (!object(manifest) || ![undefined, 1, 2].includes(manifest.contributionFormatVersion) ||
    !['capability', 'website-reference'].includes(manifest.contributionKind) ||
    !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 200 || !hex(manifest.packSha256)) fail('CONTRIBUTION_MANIFEST_INVALID');
  if (Object.keys(manifest).some((key) => !['contributionFormatVersion', 'contributionKind', 'capabilityId',
    'capabilityVersion', 'files', 'packSha256', 'disclosure', 'acceptance'].includes(key))) fail('CONTRIBUTION_MANIFEST_INVALID');
  const names = new Set(); const portableNames = new Set(); const expectedDirs = new Set();
  for (const file of manifest.files) {
    if (!object(file) || Object.keys(file).length !== 2 || !safeContributionPath(file.path) || !hex(file.sha256) ||
      file.path.split('/').includes(MANIFEST) || file.path.split('/').some((s) => forbidden.has(s)) ||
      names.has(file.path) || portableNames.has(file.path.toLowerCase())) fail('CONTRIBUTION_FILE_DECLARATION_INVALID');
    names.add(file.path); portableNames.add(file.path.toLowerCase());
    let dir = path.posix.dirname(file.path);
    while (dir !== '.') { expectedDirs.add(dir); dir = path.posix.dirname(dir); }
    if (!byPath.has(file.path) || hash(byPath.get(file.path).content) !== file.sha256) fail('CONTRIBUTION_FILE_HASH_MISMATCH');
  }
  if (byPath.size !== names.size + 1 || tree.directories.size !== expectedDirs.size ||
    [...tree.directories].some((name) => !expectedDirs.has(name))) fail('CONTRIBUTION_TREE_MISMATCH');
  if (hash(JSON.stringify(manifest.files)) !== manifest.packSha256) fail('CONTRIBUTION_PACK_HASH_MISMATCH');
  const files = tree.files.filter((file) => file.path !== MANIFEST);
  const disclosure = reviewContributionDisclosure({ files, review: publicationReview });
  if (disclosure.status === 'rejected') fail(disclosure.reasons[0]);
  // Scan the manifest too: unchecked extra receipt fields cannot be an exfiltration channel.
  const manifestPrivacy = reviewContributionDisclosure({ files: [byPath.get(MANIFEST)] });
  if (manifestPrivacy.status === 'rejected') fail(manifestPrivacy.reasons[0]);
  const capability = byPath.has('capability.json') ? parse(byPath.get('capability.json'), 'CAPABILITY_INVALID') : null;
  const reference = byPath.has('reference.json') ? parse(byPath.get('reference.json'), 'REFERENCE_INVALID') : null;
  if (Boolean(capability) === Boolean(reference)) fail('CONTRIBUTION_DEFINITION_AMBIGUOUS');
  const kind = capability ? 'capability' : 'website-reference';
  const id = capability?.id ?? reference?.capabilityId;
  const version = capability?.version ?? reference?.baseCapabilityVersion;
  if (kind !== manifest.contributionKind || id !== manifest.capabilityId || version !== manifest.capabilityVersion) fail('CONTRIBUTION_IDENTITY_MISMATCH');
  if (capability ? validateCapabilityManifest(capability).length :
    !object(reference) || Object.keys(reference).some((k) => !['capabilityId', 'baseCapabilityVersion', 'target'].includes(k)) ||
    !/^[a-z0-9-]+$/.test(id || '') || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version || '') || validateVerifiedTarget(reference.target).length) fail('CONTRIBUTION_DEFINITION_INVALID');
  const required = capability ? [capability.implementation, ...capability.fixtures, ...capability.tests,
    ...capability.verifiedTargets.flatMap((v) => v.evidence)] : reference.target.evidence;
  for (const file of required) {
    const filename = typeof file === 'string' ? file.split('#')[0] : '';
    if (!safeContributionPath(filename) || !names.has(filename)) fail('CONTRIBUTION_EVIDENCE_MISSING');
  }
  const metadata = byPath.has('contribution.json') ? parse(byPath.get('contribution.json'), 'CONTRACT_INVALID_JSON') : null;
  const acceptance = validateContributionContract(metadata);
  if (metadata && !acceptance.ok) fail(acceptance.reasons[0]);
  if (metadata) {
    if ((metadata.changeType === 'website-reference') !== (kind === 'website-reference')) fail('CONTRIBUTION_KIND_MISMATCH');
    if (kind === 'website-reference' && (metadata.base.capabilityId !== id || metadata.base.capabilityVersion !== version)) fail('CONTRIBUTION_BASE_MISMATCH');
    if (metadata.changeType === 'capability-fix' && metadata.base.capabilityId !== id) fail('CONTRIBUTION_BASE_MISMATCH');
    if (capability && (metadata.entryPoint.file !== capability.implementation.split('#')[0] ||
      metadata.verification.command.slice(2).some((file) => !capability.tests.includes(file)) ||
      metadata.verification.cases.some((item) => !capability.fixtures.includes(item.fixture)))) fail('CONTRIBUTION_EVIDENCE_MISMATCH');
    for (const file of [metadata.entryPoint?.file, ...metadata.verification.command.slice(2),
      ...metadata.verification.cases.map((item) => item.fixture)].filter(Boolean)) {
      if (!names.has(file)) fail('CONTRIBUTION_EVIDENCE_MISSING');
    }
  }
  return { files, metadata, capability, reference, manifest, disclosure, receipt: {
    receiptVersion: 1, ok: acceptance.ok, status: acceptance.status, reasons: acceptance.reasons,
    contributionKind: kind, capabilityId: id, capabilityVersion: version,
    packSha256: manifest.packSha256, publicReady: disclosure.publicReady,
    verifiedContribution: false, disclosureStatus: disclosure.status
  } };
}

export async function validateContribution(options) {
  try { return (await inspectContributionTree(options)).receipt; }
  catch (error) {
    // Neither filesystem errors nor untrusted JSON paths/values leave this boundary.
    const reason = /^[A-Z][A-Z0-9_]{0,79}$/.test(error?.message || '') ? error.message : 'CONTRIBUTION_READ_FAILED';
    return { receiptVersion: 1, ok: false, status: 'rejected', reasons: [reason],
      publicReady: false, verifiedContribution: false };
  }
}
