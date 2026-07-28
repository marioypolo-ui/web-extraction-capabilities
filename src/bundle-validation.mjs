import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REQUIRED_FILES = ['package.json', 'src/index.mjs', 'bin/web-extract.mjs'];

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function requireString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Bundle manifest field must be a non-empty string: ${field}`);
  }
}

function assertSafePath(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\\') ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    path.posix.normalize(value) !== value ||
    value.split('/').includes('..')
  ) {
    throw new Error(`Unsafe bundle path: ${String(value)}`);
  }
}

async function lstatBundleFile(bundleDir, relativePath) {
  let current = bundleDir;
  for (const segment of relativePath.split('/')) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`Bundle links are not allowed: ${relativePath}`);
    }
  }
  const stat = await fs.lstat(current);
  if (!stat.isFile()) {
    throw new Error(`Bundle entry is not a file: ${relativePath}`);
  }
  return current;
}

export async function readBundleManifest(bundleDir) {
  if (!bundleDir) {
    throw new Error('bundleDir is required');
  }
  const absoluteBundleDir = path.resolve(bundleDir);
  const rootStat = await fs.lstat(absoluteBundleDir);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error('Bundle directory must be a real directory');
  }
  const manifestPath = path.join(absoluteBundleDir, 'bundle-manifest.json');
  const manifestStat = await fs.lstat(manifestPath);
  if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) {
    throw new Error('Bundle manifest must be a real file');
  }
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Bundle manifest must be an object');
  }
  return manifest;
}

export async function validateBundle({ bundleDir, expectedVersion } = {}) {
  const absoluteBundleDir = path.resolve(bundleDir || '');
  const manifest = await readBundleManifest(bundleDir);

  if (manifest.bundleFormatVersion !== 1) {
    throw new Error(`Unsupported bundle format: ${manifest.bundleFormatVersion}`);
  }
  requireString(manifest.name, 'name');
  requireString(manifest.version, 'version');
  if (expectedVersion && manifest.version !== expectedVersion) {
    throw new Error(
      `Bundle version ${manifest.version} does not match expected version ${expectedVersion}`
    );
  }
  if (!SHA256_PATTERN.test(manifest.bundleSha256 || '')) {
    throw new Error('Bundle manifest has an invalid bundleSha256');
  }
  if (!SHA256_PATTERN.test(manifest.catalogSha256 || '')) {
    throw new Error('Bundle manifest has an invalid catalogSha256');
  }
  if (!Array.isArray(manifest.capabilities) || !Array.isArray(manifest.files)) {
    throw new Error('Bundle manifest capabilities and files must be arrays');
  }

  for (const capability of manifest.capabilities) {
    for (const field of ['id', 'version', 'status', 'scope']) {
      requireString(capability?.[field], `capabilities[].${field}`);
    }
    if (!Array.isArray(capability.verifiedTargets)) {
      throw new Error('Bundle capability verifiedTargets must be an array');
    }
  }

  const seen = new Set();
  const verifiedFiles = [];
  for (const entry of manifest.files) {
    assertSafePath(entry?.path);
    if (seen.has(entry.path)) {
      throw new Error(`Duplicate bundle path: ${entry.path}`);
    }
    seen.add(entry.path);
    if (!SHA256_PATTERN.test(entry.sha256 || '')) {
      throw new Error(`Bundle entry has an invalid SHA256: ${entry.path}`);
    }
    const file = await lstatBundleFile(absoluteBundleDir, entry.path);
    const actualSha256 = sha256(await fs.readFile(file));
    if (actualSha256 !== entry.sha256) {
      throw new Error(`Bundle file SHA256 mismatch: ${entry.path}`);
    }
    verifiedFiles.push({ path: entry.path, sha256: entry.sha256 });
  }

  for (const required of REQUIRED_FILES) {
    if (!seen.has(required)) {
      throw new Error(`Missing required runtime entry point: ${required}`);
    }
  }

  verifiedFiles.sort((left, right) => left.path.localeCompare(right.path));
  if (sha256(JSON.stringify(verifiedFiles)) !== manifest.bundleSha256) {
    throw new Error('Bundle aggregate SHA256 mismatch');
  }
  return manifest;
}
