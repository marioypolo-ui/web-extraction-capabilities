#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = path.join(root, 'bin', 'web-extract.mjs');
const fixture = path.join(root, 'fixtures', 'static-list.html');
const consumer = path.join(root, 'examples', 'standalone-consumer', 'run.mjs');
const contributionSource = path.join(root, 'examples', 'capability-contribution');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cap-docs-'));
const bundle = path.join(temp, 'bundle');
const contribution = path.join(temp, 'contribution');

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `command failed: ${args.join(' ')}`);
  }
  return JSON.parse(result.stdout);
}

try {
  const catalog = run([cli, 'catalog']);
  const validation = run([cli, 'validate', '--capability', 'static-html-list']);
  const detection = run([
    cli,
    'detect',
    '--url',
    'https://example.test/notices',
    '--html-file',
    fixture
  ]);
  const extraction = run([
    cli,
    'extract',
    '--capability',
    'static-html-list',
    '--url',
    'https://example.test/notices/',
    '--html-file',
    fixture
  ]);
  const snapshot = run([cli, 'bundle', '--output', bundle]);
  const standalone = run([
    consumer,
    '--bundle',
    bundle,
    '--html-file',
    fixture,
    '--url',
    'https://example.test/notices/'
  ]);
  const packedContribution = run([
    cli,
    'contribution:pack',
    '--source',
    contributionSource,
    '--output',
    contribution
  ]);

  const ok =
    catalog.capabilities.length >= 10 &&
    validation.errors.length === 0 &&
    detection.recommendations[0].capabilityId === 'static-html-list' &&
    extraction.records.length === 2 &&
    snapshot.version === '0.1.0' &&
    standalone.records.length === 2 &&
    packedContribution.capabilityId === 'example-card-list';
  process.stdout.write(
    `${JSON.stringify(
      {
        ok,
        commandsRun: 7,
        capabilityCount: catalog.capabilities.length,
        extractedRecords: standalone.records.length
      },
      null,
      2
    )}\n`
  );
  if (!ok) {
    process.exitCode = 1;
  }
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({ ok: false, error: { code: 'DOCS_SMOKE_FAILED', message: error.message } }, null, 2)}\n`
  );
  process.exitCode = 1;
}
