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

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const options = parseArgs(rest);

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
