// Trusted test supervisor. Production use is ONLY inside the isolation transport.
// The controller supplies a staged working directory and validated test paths.
// A passing contribution-authored test is supplementary, never central proof:
// independent baseline/candidate comparisons remain required outside this process.
import { run } from 'node:test';
import path from 'node:path';

let receipt = { ok: false, tests: 0, passed: 0, failed: 0, skipped: 0, todo: 0, cancelled: 0 };
try {
  const files = process.argv.slice(2);
  if (files[0] === '--candidate-root') {
    files.shift();
    process.chdir('/candidate');
  }
  if (!files.length || files.some((file) => !file.endsWith('.test.mjs') ||
    !file.split('/').every((part) => /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(part)))) throw new Error();
  let summary;
  const paths = files.map((file) => path.resolve(file));
  const fileSummaries = new Map();
  const stream = run({ files: paths, concurrency: 1, timeout: 10000 });
  // Consume structured supervisor events; never pipe reporters, child stdout,
  // test names, assertions or exception text into receipts or Actions logs.
  for await (const event of stream) {
    if (event.type === 'test:summary' && event.data.file === undefined) summary = event.data;
    else if (event.type === 'test:summary') fileSummaries.set(event.data.file, event.data);
  }
  if (!summary?.counts) throw new Error();
  const counts = summary.counts;
  for (const key of ['tests', 'passed', 'failed', 'skipped', 'todo', 'cancelled']) {
    if (!Number.isSafeInteger(counts[key]) || counts[key] < 0) throw new Error();
    receipt[key] = counts[key];
  }
  receipt.ok = summary.success === true && receipt.tests > 0 && receipt.passed === receipt.tests &&
    !receipt.failed && !receipt.skipped && !receipt.todo && !receipt.cancelled &&
    paths.every((file) => fileSummaries.get(file)?.success === true &&
      fileSummaries.get(file)?.counts?.tests > 0);
} catch { receipt.ok = false; }
process.stdout.write(JSON.stringify(receipt));
process.exitCode = receipt.ok ? 0 : 1;
