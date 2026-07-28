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
    value.endsWith('/') ||
    value.includes('\\') ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    path.posix.normalize(value) !== value ||
    value.split('/').includes('..')
  ) {
    throw new Error(`Unsafe bundle path: ${String(value)}`);
  }
}

async function readBundleManifest(bundleDir) {
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

function expectedDirectories(files) {
  const directories = new Set();
  for (const entry of files) {
    const segments = entry.path.split('/');
    segments.pop();
    let current = '';
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      directories.add(current);
    }
  }
  return directories;
}

async function readBundleTree(bundleDir, relativeDirectory = '') {
  const files = [];
  const directories = [];
  const directory = relativeDirectory
    ? path.join(bundleDir, ...relativeDirectory.split('/'))
    : bundleDir;
  const entries = await fs.readdir(directory);

  for (const name of entries.sort((left, right) => left.localeCompare(right))) {
    const relativePath = relativeDirectory ? `${relativeDirectory}/${name}` : name;
    const absolutePath = path.join(bundleDir, ...relativePath.split('/'));
    const stat = await fs.lstat(absolutePath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Bundle links are not allowed: ${relativePath}`);
    }
    if (stat.isDirectory()) {
      directories.push(relativePath);
      const nested = await readBundleTree(bundleDir, relativePath);
      files.push(...nested.files);
      directories.push(...nested.directories);
      continue;
    }
    if (!stat.isFile()) {
      throw new Error(`Bundle entries must be regular files or directories: ${relativePath}`);
    }
    if (relativePath !== 'bundle-manifest.json') {
      files.push({ path: relativePath, absolutePath });
    }
  }

  return { files, directories };
}

function assertExactTree(manifest, tree) {
  const expectedFiles = new Set(manifest.files.map((entry) => entry.path));
  const actualFiles = new Set(tree.files.map((entry) => entry.path));
  const expectedDirs = expectedDirectories(manifest.files);
  const actualDirs = new Set(tree.directories);

  for (const file of [...actualFiles].sort()) {
    if (!expectedFiles.has(file)) {
      throw new Error(`Unexpected bundle file: ${file}`);
    }
  }
  for (const file of [...expectedFiles].sort()) {
    if (!actualFiles.has(file)) {
      throw new Error(`Missing bundle file: ${file}`);
    }
  }
  for (const directory of [...actualDirs].sort()) {
    if (!expectedDirs.has(directory)) {
      throw new Error(`Unexpected bundle directory: ${directory}`);
    }
  }
  for (const directory of [...expectedDirs].sort()) {
    if (!actualDirs.has(directory)) {
      throw new Error(`Missing bundle directory: ${directory}`);
    }
  }
}

async function validatePackageIdentity(bundleDir, manifest) {
  const packagePath = path.join(bundleDir, 'package.json');
  let packageStat;
  try {
    packageStat = await fs.lstat(packagePath);
  } catch {
    throw new Error('Bundle package.json must be a real file');
  }
  if (packageStat.isSymbolicLink() || !packageStat.isFile()) {
    throw new Error('Bundle package.json must be a real file');
  }

  let packageJson;
  try {
    packageJson = JSON.parse(await fs.readFile(packagePath, 'utf8'));
  } catch (error) {
    throw new Error(`Bundle package.json is invalid: ${error.message}`);
  }
  if (!packageJson || typeof packageJson !== 'object' || Array.isArray(packageJson)) {
    throw new Error('Bundle package.json must be an object');
  }
  if (packageJson.name !== manifest.name) {
    throw new Error(
      `Bundle package name ${String(packageJson.name)} does not match manifest ${manifest.name}`
    );
  }
  if (packageJson.version !== manifest.version) {
    throw new Error(
      `Bundle package version ${String(packageJson.version)} does not match manifest ${manifest.version}`
    );
  }
}

export async function validateBundleManifest({ bundleDir, expectedVersion } = {}) {
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
  for (const entry of manifest.files) {
    assertSafePath(entry?.path);
    if (seen.has(entry.path)) {
      throw new Error(`Duplicate bundle path: ${entry.path}`);
    }
    seen.add(entry.path);
    if (!SHA256_PATTERN.test(entry.sha256 || '')) {
      throw new Error(`Bundle entry has an invalid SHA256: ${entry.path}`);
    }
  }

  for (const required of REQUIRED_FILES) {
    if (!seen.has(required)) {
      throw new Error(`Missing required runtime entry point: ${required}`);
    }
  }

  await validatePackageIdentity(path.resolve(bundleDir), manifest);
  return manifest;
}

export async function validateBundle({ bundleDir, expectedVersion } = {}) {
  const manifest = await validateBundleManifest({ bundleDir, expectedVersion });
  const absoluteBundleDir = path.resolve(bundleDir);
  const tree = await readBundleTree(absoluteBundleDir);
  assertExactTree(manifest, tree);

  const filesByPath = new Map(tree.files.map((entry) => [entry.path, entry.absolutePath]));
  const verifiedFiles = [];
  for (const entry of manifest.files) {
    const actualSha256 = sha256(await fs.readFile(filesByPath.get(entry.path)));
    if (actualSha256 !== entry.sha256) {
      throw new Error(`Bundle file SHA256 mismatch: ${entry.path}`);
    }
    verifiedFiles.push({ path: entry.path, sha256: entry.sha256 });
  }

  verifiedFiles.sort((left, right) => left.path.localeCompare(right.path));
  if (sha256(JSON.stringify(verifiedFiles)) !== manifest.bundleSha256) {
    throw new Error('Bundle aggregate SHA256 mismatch');
  }
  return manifest;
}
