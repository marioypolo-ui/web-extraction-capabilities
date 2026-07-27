#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanTextForSecrets } from '../src/security-audit.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const ignored = new Set(['.git', 'node_modules', 'dist', 'coverage', 'test-output']);

async function walk(directory = root) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignored.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
    } else if (entry.isFile()) {
      files.push(path.relative(root, fullPath).replaceAll('\\', '/'));
    }
  }
  return files;
}

async function candidateFiles() {
  const result = spawnSync(
    'git',
    ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, 'ls-files', '--cached', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf8' }
  );
  if (result.status === 0) {
    return result.stdout.split(/\r?\n/).filter(Boolean);
  }
  return walk();
}

const findings = [];
for (const relative of await candidateFiles()) {
  const fullPath = path.join(root, ...relative.split('/'));
  const buffer = await fs.readFile(fullPath);
  if (buffer.includes(0)) {
    continue;
  }
  findings.push(...scanTextForSecrets(relative, buffer.toString('utf8')));
}

const output = { ok: findings.length === 0, scannedFiles: (await candidateFiles()).length, findings };
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (!output.ok) {
  process.exitCode = 1;
}
