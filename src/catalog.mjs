import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateCapabilityManifest } from './capability-contract.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CAPABILITY_ROOT = path.join(ROOT, 'capabilities');

async function readManifestDirectories() {
  const entries = await fs.readdir(CAPABILITY_ROOT, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

export async function getCatalog() {
  const directories = await readManifestDirectories();
  const manifests = [];

  for (const directory of directories) {
    const manifestPath = path.join(CAPABILITY_ROOT, directory, 'capability.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    manifests.push(manifest);
  }

  return manifests.sort((left, right) => left.id.localeCompare(right.id));
}

export async function validateCatalog(capabilityId) {
  const errors = [];
  const completeCatalog = await getCatalog();
  const catalog = capabilityId
    ? completeCatalog.filter((capability) => capability.id === capabilityId)
    : completeCatalog;
  const ids = new Set();

  if (capabilityId && catalog.length === 0) {
    return { capabilityCount: 0, errors: [`unknown capability: ${capabilityId}`] };
  }

  for (const capability of catalog) {
    errors.push(
      ...validateCapabilityManifest(capability).map(
        (message) => `${capability.id || '<unknown>'}.${message}`
      )
    );
    if (ids.has(capability.id)) {
      errors.push(`duplicate capability id: ${capability.id}`);
    }
    ids.add(capability.id);

    for (const relativePath of [...(capability.fixtures || []), ...(capability.tests || [])]) {
      try {
        await fs.access(path.join(ROOT, relativePath));
      } catch {
        errors.push(`${capability.id} references missing file: ${relativePath}`);
      }
    }

    const implementationPath = capability.implementation.split('#')[0];
    try {
      await fs.access(path.join(ROOT, implementationPath));
    } catch {
      errors.push(`${capability.id} references missing implementation: ${implementationPath}`);
    }
  }

  return { capabilityCount: catalog.length, errors };
}
