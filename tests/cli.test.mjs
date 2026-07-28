import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { buildBundle, LIBRARY_VERSION } from '../src/index.mjs';

const cli = fileURLToPath(new URL('../bin/web-extract.mjs', import.meta.url));

test('catalog CLI writes only parseable JSON to stdout', () => {
  const result = spawnSync(process.execPath, [cli, 'catalog'], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.capabilities.length >= 10);
});

test('catalog CLI finds verified website references by URL', () => {
  const result = spawnSync(
    process.execPath,
    [
      cli,
      'catalog',
      '--url',
      'https://www.gxufe.edu.cn/www/myweb/level.html?typeid=www010e&typeid0=www01'
    ],
    { encoding: 'utf8' }
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.matches[0].capabilityId, 'tender-platform-families');
  assert.equal(parsed.matches[0].target.name, '广西财经学院');
});

test('unknown CLI command fails with JSON instead of mixed console output', () => {
  const result = spawnSync(process.execPath, [cli, 'unknown-command'], { encoding: 'utf8' });

  assert.notEqual(result.status, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.error.code, 'UNKNOWN_COMMAND');
});

test('detect and extract CLI commands accept saved HTML without network access', () => {
  const htmlFile = fileURLToPath(new URL('../fixtures/static-list.html', import.meta.url));
  const detected = spawnSync(
    process.execPath,
    [cli, 'detect', '--url', 'https://example.test/notices', '--html-file', htmlFile],
    { encoding: 'utf8' }
  );
  const extracted = spawnSync(
    process.execPath,
    [
      cli,
      'extract',
      '--capability',
      'static-html-list',
      '--url',
      'https://example.test/notices/',
      '--html-file',
      htmlFile
    ],
    { encoding: 'utf8' }
  );

  assert.equal(detected.status, 0, detected.stderr);
  assert.equal(JSON.parse(detected.stdout).recommendations[0].capabilityId, 'static-html-list');
  assert.equal(extracted.status, 0, extracted.stderr);
  assert.equal(JSON.parse(extracted.stdout).records.length, 2);
});

test('validate CLI can validate one capability', () => {
  const result = spawnSync(
    process.execPath,
    [cli, 'validate', '--capability', 'static-html-list'],
    { encoding: 'utf8' }
  );

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.capabilityCount, 1);
  assert.deepEqual(parsed.errors, []);
});

test('bundle CLI creates a versioned snapshot manifest', () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cap-cli-bundle-'));
  const result = spawnSync(process.execPath, [cli, 'bundle', '--output', output], {
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).version, LIBRARY_VERSION);
  assert.equal(fs.existsSync(path.join(output, 'bundle-manifest.json')), true);
});

test('bundle:validate CLI validates a generated standalone bundle', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'web-cap-cli-bundle-validate-'));
  const output = path.join(root, 'bundle');
  await buildBundle({ outputDir: output });
  const bundledCli = path.join(output, 'bin', 'web-extract.mjs');
  const validation = spawnSync(
    process.execPath,
    [
      bundledCli,
      'bundle:validate',
      '--bundle',
      output,
      '--expected-version',
      LIBRARY_VERSION
    ],
    { encoding: 'utf8' }
  );

  assert.equal(validation.status, 0, validation.stderr);
  assert.equal(JSON.parse(validation.stdout).version, LIBRARY_VERSION);
});

test('contribution:pack CLI creates a restricted contribution package', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cap-cli-contribution-'));
  const source = path.join(root, 'source');
  const output = path.join(root, 'output');
  fs.mkdirSync(source);
  fs.writeFileSync(
    path.join(source, 'capability.json'),
    JSON.stringify({
      id: 'cli-sample',
      version: '0.1.0',
      type: 'static-html',
      scope: 'generic',
      status: 'supported',
      detection: ['Synthetic marker'],
      appliesTo: ['Synthetic page'],
      notAppliesTo: ['Other pages'],
      requirements: { http: true },
      verifiedTargets: [],
      implementation: 'adapter.mjs',
      fixtures: ['fixture.html'],
      tests: ['adapter.test.mjs']
    })
  );
  fs.writeFileSync(path.join(source, 'adapter.mjs'), 'export {};\n');
  fs.writeFileSync(path.join(source, 'fixture.html'), '<p>fixture</p>\n');
  fs.writeFileSync(path.join(source, 'adapter.test.mjs'), 'export {};\n');

  const result = spawnSync(
    process.execPath,
    [cli, 'contribution:pack', '--source', source, '--output', output],
    { encoding: 'utf8' }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).capabilityId, 'cli-sample');
  assert.equal(fs.existsSync(path.join(output, 'contribution-manifest.json')), true);
});
