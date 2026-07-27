#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanTextForSecrets } from '../src/security-audit.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const ignored = new Set(['.git', 'node_modules', 'dist', 'coverage', 'test-output']);
const scanHistory = process.argv.includes('--history');

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

const files = await candidateFiles();
const findings = [];
if (scanHistory) {
  const history = spawnSync(
    'git',
    [
      '-c',
      `safe.directory=${root.replaceAll('\\', '/')}`,
      'log',
      '-p',
      '--all',
      '--no-ext-diff',
      '--no-textconv'
    ],
    { cwd: root, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }
  );
  if (history.status !== 0) {
    findings.push({
      code: 'HISTORY_SCAN_FAILED',
      file: '.git',
      line: 0,
      message: history.stderr.trim() || 'Unable to inspect Git history.'
    });
  }
  findings.push(...scanTextForSecrets('git-history.patch', history.stdout));
} else {
  for (const relative of files) {
    const fullPath = path.join(root, ...relative.split('/'));
    const buffer = await fs.readFile(fullPath);
    if (buffer.includes(0)) {
      continue;
    }
    findings.push(...scanTextForSecrets(relative, buffer.toString('utf8')));
  }
}

const output = {
  ok: findings.length === 0,
  scannedFiles: files.length,
  scannedHistory: scanHistory,
  findings
};
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (!output.ok) {
  process.exitCode = 1;
}
