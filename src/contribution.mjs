import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { validateCapabilityManifest } from './capability-contract.mjs';

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const FORBIDDEN_SEGMENTS = new Set([
  '.git',
  '.github',
  'node_modules',
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json'
]);

async function listFiles(root, current = root) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const fullPath = path.join(current, entry.name);
    const relative = path.relative(root, fullPath).replaceAll('\\', '/');
    const segments = relative.split('/');
    if (segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment))) {
      throw new Error(`forbidden contribution path: ${relative}`);
    }
    if (entry.isSymbolicLink()) {
      throw new Error(`forbidden contribution path: ${relative} is a symbolic link`);
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

export async function packContribution({ sourceDir, outputDir }) {
  if (!sourceDir || !outputDir) {
    throw new Error('sourceDir and outputDir are required');
  }
  const manifestPath = path.join(sourceDir, 'capability.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  validateManifest(manifest);
  const files = await listFiles(sourceDir);
  const relativePaths = new Set(files.map((item) => item.relative));
  for (const requiredPath of [
    manifest.implementation,
    ...(manifest.fixtures || []),
    ...(manifest.tests || [])
  ]) {
    if (!relativePaths.has(requiredPath)) {
      throw new Error(`manifest references missing contribution file: ${requiredPath}`);
    }
  }

  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });
  const packedFiles = [];
  for (const file of files) {
    const content = await fs.readFile(file.fullPath);
    const destination = path.join(outputDir, ...file.relative.split('/'));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, content);
    packedFiles.push({ path: file.relative, sha256: sha256(content) });
  }
  packedFiles.sort((left, right) => left.path.localeCompare(right.path));
  const result = {
    capabilityId: manifest.id,
    capabilityVersion: manifest.version,
    files: packedFiles,
    packSha256: sha256(JSON.stringify(packedFiles))
  };
  await fs.writeFile(
    path.join(outputDir, 'contribution-manifest.json'),
    `${JSON.stringify(result, null, 2)}\n`
  );
  return result;
}
