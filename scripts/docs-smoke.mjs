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
const referenceContributionSource = path.join(
  root,
  'examples',
  'website-reference-contribution'
);
const readmeZh = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const readmeEn = fs.readFileSync(path.join(root, 'README.en.md'), 'utf8');
const integrationGuide = fs.readFileSync(path.join(root, 'docs', 'integration.md'), 'utf8');
const diagnosticsGuide = fs.readFileSync(path.join(root, 'docs', 'diagnostics.md'), 'utf8');
const upgradesGuide = fs.readFileSync(path.join(root, 'docs', 'upgrades.md'), 'utf8');
const authoringGuide = fs.readFileSync(path.join(root, 'docs', 'capability-authoring.md'), 'utf8');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'web-cap-docs-'));
const bundle = path.join(temp, 'bundle');
const contribution = path.join(temp, 'contribution');
const referenceContribution = path.join(temp, 'reference-contribution');

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `command failed: ${args.join(' ')}`);
  }
  return JSON.parse(result.stdout);
}

function documentsDirectRoutingContract(content) {
  const concepts = [
    [/中国政府/, /Chinese government/i],
    [/政府部门/, /government-department/i],
    [/行政事业单位/, /public-institution/i],
    [/HTTP_PROXY/],
    [/HTTPS_PROXY/],
    [/ALL_PROXY/],
    [/系统全局代理/, /global system proxy/i],
    [/必须.*直连/s, /强制直连/, /require(?:s)? a direct route/i],
    [/direct dispatcher/i],
    [/NO_PROXY/],
    [
      /直连失败.*(?:显性|可见).*诊断/s,
      /(?:direct route fails|failed direct route).*?(?:application-visible|emit).*diagnostic/is,
      /(?:application-visible|emit).*diagnostic.*?direct route fails/is
    ],
    [/禁止.*静默.*代理/s, /不得.*静默.*代理/s, /(?:never|must not).*silently.*proxy/is],
    [/中央库只规定.*契约/s, /central library defines this (?:diagnostic )?contract only/is],
    [/应用.*网络层/s, /application.*network layer/is]
  ];
  return concepts.every((patterns) => patterns.some((pattern) => pattern.test(content)));
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
  const packedReference = run([
    cli,
    'contribution:pack',
    '--source',
    referenceContributionSource,
    '--output',
    referenceContribution
  ]);
  const updatePolicyDocumented =
    readmeZh.includes('更新方式选择') &&
    readmeEn.includes('Choose an update mode') &&
    ['GitHub Releases', '自动检查', '手动检查', '暂不检查', 'SHA256', '回滚'].every((term) =>
      upgradesGuide.includes(term)
    );
  const referenceFeedbackDocumented =
    readmeZh.includes('网站参考与能力回流') &&
    readmeEn.includes('Website references and capability feedback') &&
    upgradesGuide.includes('catalogSha256') &&
    authoringGuide.includes('verifiedTargets') &&
    authoringGuide.includes('catalog --url');
  const directRoutingDocumentation = Object.fromEntries(
    Object.entries({
      'README.md': readmeZh,
      'README.en.md': readmeEn,
      'docs/integration.md': integrationGuide,
      'docs/diagnostics.md': diagnosticsGuide,
      'docs/upgrades.md': upgradesGuide
    }).map(([name, content]) => [name, documentsDirectRoutingContract(content)])
  );
  const directRoutingDocumented = Object.values(directRoutingDocumentation).every(Boolean);

  const ok =
    catalog.capabilities.length >= 10 &&
    validation.errors.length === 0 &&
    detection.recommendations[0].capabilityId === 'static-html-list' &&
    extraction.records.length === 2 &&
    snapshot.version === '0.1.3' &&
    snapshot.bundleFormatVersion === 1 &&
    standalone.records.length === 2 &&
    packedContribution.capabilityId === 'example-card-list' &&
    packedReference.contributionKind === 'website-reference' &&
    updatePolicyDocumented &&
    referenceFeedbackDocumented &&
    directRoutingDocumented;
  process.stdout.write(
    `${JSON.stringify(
      {
        ok,
        commandsRun: 8,
        capabilityCount: catalog.capabilities.length,
        extractedRecords: standalone.records.length,
        updatePolicyDocumented,
        referenceFeedbackDocumented,
        directRoutingDocumented,
        directRoutingDocumentation
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
