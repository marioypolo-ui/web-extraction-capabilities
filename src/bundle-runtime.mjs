import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { readBundleManifest, validateBundle } from './bundle-validation.mjs';

const REQUIRED_APIS = [
  'getCatalog',
  'findCapabilitiesForUrl',
  'detectCapabilities',
  'extract',
  'fetchResource',
  'normalizeUrl'
];

export async function createBundleRuntime({
  bundleDir,
  expectedVersion,
  validate = true
} = {}) {
  if (!bundleDir) {
    throw new Error('bundleDir is required');
  }
  const absoluteBundleDir = path.resolve(bundleDir);
  const manifest = validate
    ? await validateBundle({ bundleDir: absoluteBundleDir, expectedVersion })
    : await readBundleManifest(absoluteBundleDir);
  if (expectedVersion && manifest.version !== expectedVersion) {
    throw new Error(
      `Bundle version ${manifest.version} does not match expected version ${expectedVersion}`
    );
  }
  const moduleUrl = pathToFileURL(path.join(absoluteBundleDir, 'src', 'index.mjs')).href;
  const runtimeModule = await import(moduleUrl);

  if (runtimeModule.LIBRARY_VERSION !== manifest.version) {
    throw new Error(
      `Bundle module version ${runtimeModule.LIBRARY_VERSION} does not match manifest ${manifest.version}`
    );
  }
  for (const api of REQUIRED_APIS) {
    if (typeof runtimeModule[api] !== 'function') {
      throw new Error(`Bundle runtime API is missing: ${api}`);
    }
  }

  return Object.freeze({
    version: manifest.version,
    bundleFormatVersion: manifest.bundleFormatVersion,
    catalogSha256: manifest.catalogSha256,
    bundleDir: absoluteBundleDir,
    ...Object.fromEntries(REQUIRED_APIS.map((api) => [api, (...args) => runtimeModule[api](...args)]))
  });
}
