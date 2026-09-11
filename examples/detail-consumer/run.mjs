#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function parseArgs(values) {
  const options = {};
  const supported = new Set(['--bundle', '--url', '--html-file', '--json-file', '--config']);
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!supported.has(flag) || !value || value.startsWith('--')) {
      throw new Error(`Expected a supported flag and value: ${flag}`);
    }
    const name = flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    options[name] = value;
  }
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (!options.bundle || !options.url) {
    throw new Error('--bundle and --url are required');
  }
  if (options.htmlFile && options.jsonFile) {
    throw new Error('Provide either --html-file or --json-file');
  }
  const entry = path.join(path.resolve(options.bundle), 'src', 'index.mjs');
  const { extractDetail } = await import(pathToFileURL(entry));
  if (typeof extractDetail !== 'function') {
    throw new Error('This bundle does not expose extractDetail; use version 0.2.0 or newer');
  }
  const html = options.htmlFile ? await fs.readFile(options.htmlFile, 'utf8') : undefined;
  const json = options.jsonFile
    ? JSON.parse(await fs.readFile(options.jsonFile, 'utf8'))
    : undefined;
  const config = options.config
    ? JSON.parse(await fs.readFile(options.config, 'utf8'))
    : undefined;
  const result = await extractDetail({ url: options.url, html, json, config });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.document || result.diagnostics.some((item) => item.severity === 'error')) {
    process.exitCode = 1;
  }
} catch (error) {
  process.exitCode = 1;
  process.stdout.write(
    `${JSON.stringify({ error: { code: 'CONSUMER_FAILED', message: error.message } }, null, 2)}\n`
  );
}
