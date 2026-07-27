#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function parseArgs(values) {
  const options = {};
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index]?.replace(/^--/, '').replace(/-([a-z])/g, (_, letter) =>
      letter.toUpperCase()
    );
    if (name) {
      options[name] = values[index + 1];
    }
  }
  return options;
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (!options.bundle || !options.htmlFile) {
    throw new Error('--bundle and --html-file are required');
  }
  const entry = path.join(path.resolve(options.bundle), 'src', 'index.mjs');
  const { extract } = await import(pathToFileURL(entry));
  const html = await fs.readFile(options.htmlFile, 'utf8');
  const result = await extract({
    capabilityId: 'static-html-list',
    url: options.url || 'https://example.test/notices/',
    html
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.exitCode = 1;
  process.stdout.write(
    `${JSON.stringify({ error: { code: 'CONSUMER_FAILED', message: error.message } }, null, 2)}\n`
  );
}
