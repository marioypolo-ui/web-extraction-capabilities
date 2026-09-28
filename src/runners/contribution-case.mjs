// Trusted entrypoint copied into an isolated container by the controller.
// No expectations or acceptance authority are present in this process.
import { pathToFileURL } from 'node:url';

try {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 2 * 1024 * 1024) throw new Error();
  }
  const [mode, operation, filename, exportName] = process.argv.slice(2);
  const value = JSON.parse(input);
  let result;
  if (mode === 'baseline') {
    const baseline = await import('/baseline/src/index.mjs');
    result = await (operation === 'detail' ? baseline.extractDetail(value) : baseline.extract(value));
  } else if (mode === 'candidate' && typeof filename === 'string' &&
    filename.split('/').every((part) => /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(part)) &&
    /^[A-Za-z_$][\w$]*$/.test(exportName)) {
    const candidate = await import(pathToFileURL(`/candidate/${filename}`).href);
    if (typeof candidate[exportName] !== 'function') throw new Error();
    result = await candidate[exportName](value);
  } else throw new Error();
  process.stdout.write(JSON.stringify(result));
} catch {
  // A contribution exception can contain private input. Never print it.
  process.stderr.write('ISOLATED_CASE_FAILED\n');
  process.exitCode = 1;
}
