#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

function parseArgs(values) {
  const options = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) {
      continue;
    }
    const key = value.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    options[key] = values[index + 1] && !values[index + 1].startsWith('--') ? values[++index] : true;
  }
  return options;
}

async function readJsonOption(value) {
  if (!value) {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch {
    return JSON.parse(await fs.readFile(value, 'utf8'));
  }
}

async function buildInput(options) {
  return {
    url: options.url || '',
    capabilityId: options.capability || 'auto',
    html: options.htmlFile ? await fs.readFile(options.htmlFile, 'utf8') : undefined,
    json: options.jsonFile ? JSON.parse(await fs.readFile(options.jsonFile, 'utf8')) : undefined,
    config: await readJsonOption(options.config)
  };
}

async function readProblemReport(file) {
  if (typeof file !== 'string' || !file) throw new Error('--report is required');
  const stat = await fs.stat(file);
  if (stat.size > 240000) throw new Error('Feedback JSON exceeds the size limit');
  const text = await fs.readFile(file, 'utf8');
  if (text.length > 60000) throw new Error('Feedback JSON exceeds the size limit');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Feedback JSON is malformed');
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const options = parseArgs(rest);

  if (command === 'contribution:protocol') {
    const { CONTRIBUTION_PROTOCOL } = await import('../src/contribution-contract.mjs');
    return CONTRIBUTION_PROTOCOL;
  }
  if (command === 'contribution:validate') {
    const { validateContribution } = await import('../src/contribution-validation.mjs');
    const result = await validateContribution({ contributionDir: options.contribution,
      publicationReview: options.publicationReview ? await readProblemReport(options.publicationReview) : undefined });
    if (!result.ok) process.exitCode = 1;
    return result;
  }
  if (command === 'contribution:verify') {
    const { verifyContribution } = await import('../src/contribution-verification.mjs');
    const result = await verifyContribution({ contributionDir: options.contribution, image: options.image,
      publicationReview: options.publicationReview ? await readProblemReport(options.publicationReview) : undefined,
      baseline: { bundleDir: options.baseline, bundleSha256: options.baselineSha256,
        manifestSha256: options.baselineManifestSha256 } });
    if (!result.ok) process.exitCode = 1;
    return result;
  }
  if (command === 'contribution:receive') {
    const { receiveContribution } = await import('../src/contribution-intake.mjs');
    const result = await receiveContribution({ storeDir: options.store, contributionDir: options.contribution,
      image: options.image, publicationReview: options.publicationReview ? await readProblemReport(options.publicationReview) : undefined,
      baseline: { bundleDir: options.baseline, bundleSha256: options.baselineSha256,
        manifestSha256: options.baselineManifestSha256 } });
    if (!result.ok) process.exitCode = 1;
    return result;
  }
  if (command === 'contribution:status') {
    const { getContributionStatus } = await import('../src/contribution-intake.mjs');
    const result = await getContributionStatus({ storeDir: options.store, contributionKey: options.key });
    if (!result.ok) process.exitCode = 1;
    return result;
  }
  if (command === 'contribution:integration-record' || command === 'contribution:publication') {
    const { prepareContributionIntegration, getContributionPublicationStatus } = await import('../src/contribution-publication.mjs');
    const input = { storeDir: options.store, contributionKey: options.key, eventId: options.event };
    const result = command === 'contribution:integration-record' ? await prepareContributionIntegration(input)
      : await getContributionPublicationStatus({ ...input,
        pullRequestNumber: typeof options.pullRequest === 'string' && /^\d+$/.test(options.pullRequest) ? Number(options.pullRequest) : NaN,
        releaseTag: options.release });
    if (!result.ok) process.exitCode = 1;
    return result;
  }

  if (command === 'feedback:classify') {
    const { classifyProblem } = await import('../src/problem-classification.mjs');
    return classifyProblem(await readProblemReport(options.report));
  }

  if (command === 'feedback:validate' || command === 'feedback:reproduce') {
    const { validateProblemReport, reproduceProblem } = await import('../src/problem-feedback.mjs');
    const report = await readProblemReport(options.report);
    const result = command === 'feedback:validate'
      ? validateProblemReport(report) : await reproduceProblem(report);
    if (command === 'feedback:validate' ? !result.ok : result.status !== 'not-reproduced') {
      process.exitCode = 1;
    }
    return result;
  }

  if (command === 'bundle:validate') {
    const { validateBundle } = await import('../src/bundle-validation.mjs');
    return validateBundle({
      bundleDir: path.resolve(options.bundle || ''),
      expectedVersion: options.expectedVersion
    });
  }

  const {
    buildBundle,
    detectCapabilities,
    extract,
    extractDetail,
    findCapabilitiesForUrl,
    getCatalog,
    packContribution,
    validateCatalog
  } = await import('../src/index.mjs');

  if (command === 'catalog') {
    if (options.url) {
      return { url: options.url, matches: await findCapabilitiesForUrl(options.url) };
    }
    return { capabilities: await getCatalog() };
  }
  if (command === 'validate') {
    const validation = await validateCatalog(options.capability);
    if (validation.errors.length) {
      process.exitCode = 1;
    }
    return validation;
  }
  if (command === 'detect') {
    const input = await buildInput(options);
    return detectCapabilities(input);
  }
  if (command === 'extract') {
    return extract(await buildInput(options));
  }
  if (command === 'detail') {
    const result = await extractDetail(await buildInput(options));
    if (!result.document) {
      process.exitCode = 1;
    }
    return result;
  }
  if (command === 'bundle') {
    return buildBundle({ outputDir: path.resolve(options.output || 'dist/bundle') });
  }
  if (command === 'contribution:pack') {
    return packContribution({
      sourceDir: path.resolve(options.source || ''),
      outputDir: path.resolve(options.output || 'dist/contribution')
    });
  }

  process.exitCode = 2;
  return {
    error: {
      code: 'UNKNOWN_COMMAND',
      message: `Unknown command: ${command || '<missing>'}`
    }
  };
}

try {
  const output = await main();
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} catch (error) {
  process.exitCode = 1;
  process.stdout.write(
    `${JSON.stringify({ error: { code: 'COMMAND_FAILED', message: error.message } }, null, 2)}\n`
  );
}
