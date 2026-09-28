import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { safeContributionPath, validateContributionContract } from './contribution-contract.mjs';
import { reviewContributionDisclosure } from './contribution-privacy.mjs';

import {
  validateCapabilityManifest,
  validateVerifiedTarget
} from './capability-contract.mjs';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const FORBIDDEN_SEGMENTS = new Set([
  '.git',
  '.github',
  'node_modules',
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'contribution-manifest.json'
]);

async function listFiles(root, current = root) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const fullPath = path.join(current, entry.name);
    const relative = path.relative(root, fullPath).replaceAll('\\', '/');
    const segments = relative.split('/');
    if (!safeContributionPath(relative) || segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment))) {
      throw new Error('forbidden contribution path');
    }
    if (entry.isSymbolicLink()) {
      throw new Error('forbidden contribution path: symbolic link');
    }
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, fullPath)));
    } else if (entry.isFile()) {
      files.push({ fullPath, relative });
    }
  }
  return files;
}

function validateManifest(manifest) {
  const errors = validateCapabilityManifest(manifest);
  if (errors.length) {
    throw new Error(errors.join('; '));
  }
}

async function readContributionDefinition(sourceDir) {
  try {
    const manifest = JSON.parse(
      await fs.readFile(path.join(sourceDir, 'capability.json'), 'utf8')
    );
    validateManifest(manifest);
    return {
      kind: 'capability',
      capabilityId: manifest.id,
      capabilityVersion: manifest.version,
      requiredPaths: [
        manifest.implementation,
        ...(manifest.fixtures || []),
        ...(manifest.tests || []),
        ...(manifest.verifiedTargets || []).flatMap((target) => target.evidence || [])
      ]
    };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  const reference = JSON.parse(
    await fs.readFile(path.join(sourceDir, 'reference.json'), 'utf8')
  );
  const errors = [];
  if (!/^[a-z0-9-]+$/.test(reference.capabilityId || '')) {
    errors.push('capabilityId must use lowercase letters, digits, and hyphens');
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(reference.baseCapabilityVersion || '')) {
    errors.push('baseCapabilityVersion must be semantic version text');
  }
  errors.push(...validateVerifiedTarget(reference.target, 'target'));
  if (errors.length) {
    throw new Error(errors.join('; '));
  }
  return {
    kind: 'website-reference',
    capabilityId: reference.capabilityId,
    capabilityVersion: reference.baseCapabilityVersion,
    requiredPaths: reference.target.evidence || []
  };
}

async function canonicalOutput(target) {
  try { return await fs.realpath(target); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = path.dirname(target);
    if (parent === target) throw new Error('OUTPUT_PATH_UNSAFE');
    return path.join(await canonicalOutput(parent), path.basename(target));
  }
}

export async function packContribution({ sourceDir, outputDir, publicationReview }) {
  if (!sourceDir || !outputDir) {
    throw new Error('sourceDir and outputDir are required');
  }
  if ((await fs.lstat(sourceDir)).isSymbolicLink()) throw new Error('forbidden contribution path: source link');
  sourceDir = await fs.realpath(sourceDir);
  outputDir = await canonicalOutput(path.resolve(outputDir));
  const inside = (parent, child) => {
    const relative = path.relative(parent, child);
    return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  };
  if (inside(sourceDir, outputDir) || inside(outputDir, sourceDir)) throw new Error('OUTPUT_PATH_UNSAFE');
  const definition = await readContributionDefinition(sourceDir);
  const files = await listFiles(sourceDir);
  const relativePaths = new Set(files.map((item) => item.relative));
  for (const requiredPath of definition.requiredPaths) {
    const normalizedPath = String(requiredPath).split('#')[0];
    if (!relativePaths.has(normalizedPath)) {
      throw new Error(`manifest references missing contribution file: ${requiredPath}`);
    }
  }

  const snapshots = await Promise.all(files.map(async (file) => ({
    path: file.relative, content: await fs.readFile(file.fullPath)
  })));
  const disclosure = reviewContributionDisclosure({ files: snapshots, review: publicationReview });
  if (disclosure.status === 'rejected') throw new Error(disclosure.reasons.join('; '));
  const metadataFile = snapshots.find((file) => file.path === 'contribution.json');
  let metadata = null;
  if (metadataFile) {
    try { metadata = JSON.parse(metadataFile.content.toString('utf8')); }
    catch { throw new Error('CONTRACT_INVALID_JSON'); }
  }
  const acceptance = validateContributionContract(metadata);
  if (metadataFile && !acceptance.ok) throw new Error(acceptance.reasons.join('; '));
  if (metadataFile) {
    if ((metadata.changeType === 'website-reference') !== (definition.kind === 'website-reference')) throw new Error('CONTRIBUTION_KIND_MISMATCH');
    for (const entry of [metadata.entryPoint?.file, ...metadata.verification.command.slice(2),
      ...metadata.verification.cases.map((item) => item.fixture)].filter(Boolean)) {
      if (!relativePaths.has(entry)) throw new Error('CONTRIBUTION_EVIDENCE_MISSING');
    }
  }
  await fs.mkdir(path.dirname(outputDir), { recursive: true });
  try { await fs.mkdir(outputDir); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('OUTPUT_ALREADY_EXISTS');
    throw error;
  }
  const packedFiles = [];
  for (const file of snapshots) {
    const content = file.content;
    const destination = path.join(outputDir, ...file.path.split('/'));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, content);
    packedFiles.push({ path: file.path, sha256: sha256(content) });
  }
  packedFiles.sort((left, right) => left.path.localeCompare(right.path));
  const result = {
    contributionFormatVersion: 2,
    contributionKind: definition.kind,
    capabilityId: definition.capabilityId,
    capabilityVersion: definition.capabilityVersion,
    files: packedFiles,
    packSha256: sha256(JSON.stringify(packedFiles)),
    disclosure,
    acceptance
  };
  await fs.writeFile(
    path.join(outputDir, 'contribution-manifest.json'),
    `${JSON.stringify(result, null, 2)}\n`
  );
  return result;
}
