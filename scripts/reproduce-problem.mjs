#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { reproduceProblem } from '../src/problem-feedback.mjs';
import { LIBRARY_VERSION } from '../src/result.mjs';

export const MAX_REPORT_CHARACTERS = 60000;

export async function runReproductionInput(text) {
  try {
    if (typeof text !== 'string' || text.length > MAX_REPORT_CHARACTERS) throw new Error();
    return await reproduceProblem(JSON.parse(text));
  } catch {
    return { ok: false, status: 'invalid', problemKey: null, reportedVersion: null,
      testedVersion: LIBRARY_VERSION, operation: null, symptom: null, replayMode: 'offline',
      checks: [], diagnosticCodes: [], errors: ['Expected one bounded, valid feedback JSON report.'] };
  }
}

async function main() {
  let text = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    text += chunk;
    if (text.length > MAX_REPORT_CHARACTERS) break;
  }
  process.stdout.write(`${JSON.stringify(await runReproductionInput(text))}\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => {
    process.stdout.write('{"ok":false,"status":"invalid","errors":["Could not read feedback JSON."]}\n');
    process.exitCode = 1;
  });
}
