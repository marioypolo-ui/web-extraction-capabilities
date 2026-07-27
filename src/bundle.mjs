import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const INCLUDED = ['bin', 'capabilities', 'schemas', 'src', 'package.json', 'LICENSE'];

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

async function filesUnder(target) {
  const stat = await fs.stat(target);
  if (stat.isFile()) {
    return [target];
  }
  const entries = await fs.readdir(target, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => filesUnder(path.join(target, entry.name)))
  );
  return nested.flat();
}

export async function buildBundle({ outputDir }) {
  if (!outputDir) {
    throw new Error('outputDir is required');
  }
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });
  const files = [];

  for (const entry of INCLUDED) {
    const source = path.join(ROOT, entry);
    try {
      const sourceFiles = await filesUnder(source);
      for (const sourceFile of sourceFiles) {
        const relative = path.relative(ROOT, sourceFile).replaceAll('\\', '/');
        const content = await fs.readFile(sourceFile);
        const destination = path.join(outputDir, ...relative.split('/'));
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.writeFile(destination, content);
        files.push({ path: relative, sha256: sha256(content) });
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  files.sort((left, right) => left.path.localeCompare(right.path));
  const bundleSha256 = sha256(JSON.stringify(files));
  const manifest = {
    name: '@marioypolo/web-extraction-capabilities',
    version: '0.1.0',
    bundleSha256,
    files
  };
  await fs.writeFile(
    path.join(outputDir, 'bundle-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
  return manifest;
}
