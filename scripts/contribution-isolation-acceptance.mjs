// Explicit acceptance command, not an optional/skipped part of npm test.
// Requires a trusted fixed baseline Bundle and preinstalled pinned Linux image.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { runIsolatedNode } from '../src/contribution-isolation.mjs';
import { packContribution, verifyContribution, receiveContribution, getContributionStatus } from '../src/index.mjs';
import { inspectContributionTree } from '../src/contribution-validation.mjs';

const options = {};
for (let i = 2; i < process.argv.length; i += 2) options[process.argv[i]] = process.argv[i + 1];
const image = options['--image'];
const baseline = { bundleDir: options['--baseline'], bundleSha256: options['--baseline-sha256'],
  manifestSha256: options['--baseline-manifest-sha256'] };
const checks = [];
let listener;
const requireRun = (result) => {
  if (!result.ok) throw Object.assign(new Error(result.reason), { blocked: result.status === 'blocked' });
  return JSON.parse(result.stdout);
};
try {
  if (!/^sha256:[a-f0-9]{64}$/.test(image || '') || !baseline.bundleDir ||
    ![baseline.bundleSha256, baseline.manifestSha256].every((v) => /^[a-f0-9]{64}$/.test(v || ''))) {
    throw Object.assign(new Error('PINNED_ACCEPTANCE_INPUTS_REQUIRED'), { blocked: true });
  }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'central-isolation-acceptance-'));
  const probeDir = path.join(root, 'probe');
  await fs.mkdir(probeDir, { mode: 0o755 });
  await fs.writeFile(path.join(probeDir, 'readonly.txt'), 'SYNTHETIC_READ_CONTROL', { mode: 0o644 });
  // First verify backend availability without starting host resources.
  requireRun(await runIsolatedNode({ image, mounts: [{ source: probeDir, target: '/candidate' }],
    args: ['-e', 'process.stdout.write(JSON.stringify({ready:true}))'] }));
  const hostFile = path.join(root, 'unmounted-host-marker.txt');
  await fs.writeFile(hostFile, 'SYNTHETIC_HOST_MARKER');
  const address = Object.values(os.networkInterfaces()).flat().find((n) => n && !n.internal && n.family === 'IPv4')?.address;
  if (!address) throw Object.assign(new Error('HOST_PROBE_ADDRESS_UNAVAILABLE'), { blocked: true });
  listener = net.createServer((socket) => socket.end());
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '0.0.0.0', resolve); });
  const port = listener.address().port;
  await new Promise((resolve, reject) => {
    const socket = net.connect({ host: address, port });
    socket.setTimeout(1500, () => { socket.destroy(); reject(new Error('HOST_NETWORK_CONTROL_FAILED')); });
    socket.once('error', reject); socket.once('connect', () => { socket.destroy(); resolve(); });
  });
  const probe = `import fs from 'node:fs/promises';
import net from 'node:net';
let input='';for await(const chunk of process.stdin) input+=chunk;
const value=JSON.parse(input);
const denied=async(fn)=>{try{await fn();return false;}catch{return true;}};
const readable=(await fs.readFile('/candidate/readonly.txt','utf8'))==='SYNTHETIC_READ_CONTROL';
const hostRead=await denied(()=>fs.readFile(value.hostFile));
const mountWrite=await denied(()=>fs.appendFile('/candidate/readonly.txt','changed'));
const rootWrite=await denied(()=>fs.writeFile('/central-isolation-write-probe','changed'));
const network=await new Promise(resolve=>{const s=net.connect({host:value.address,port:value.port});
 const done=v=>{s.destroy();resolve(v);};s.setTimeout(1500,()=>done(true));s.once('error',()=>done(true));s.once('connect',()=>done(false));});
process.stdout.write(JSON.stringify({readable,hostRead,mountWrite,rootWrite,network,nonRoot:process.getuid()!==0}));`;
  await fs.writeFile(path.join(probeDir, 'probe.mjs'), probe, { mode: 0o644 });
  const denial = requireRun(await runIsolatedNode({ image, mounts: [{ source: probeDir, target: '/candidate' }],
    args: ['/candidate/probe.mjs'], input: JSON.stringify({ hostFile, address, port }) }));
  assert.deepEqual(denial, { readable: true, hostRead: true, mountWrite: true, rootWrite: true, network: true, nonRoot: true });
  assert.equal(await fs.readFile(hostFile, 'utf8'), 'SYNTHETIC_HOST_MARKER');
  assert.equal(await fs.readFile(path.join(probeDir, 'readonly.txt'), 'utf8'), 'SYNTHETIC_READ_CONTROL');
  await new Promise((resolve) => listener.close(resolve)); listener = undefined;
  checks.push('host-read-network-write-denied');

  let sequence = 0;
  const prepare = async (example, mutate) => {
    const taskRoot = path.join(root, `case-${sequence++}`);
    const sourceDir = path.join(taskRoot, 'source');
    await fs.cp(fileURLToPath(new URL(`../examples/${example}/`, import.meta.url)), sourceDir, { recursive: true });
    if (mutate) await mutate(sourceDir);
    const contributionDir = path.join(taskRoot, 'pack');
    await packContribution({ sourceDir, outputDir: contributionDir });
    const inspected = await inspectContributionTree({ contributionDir });
    return { contributionDir, image, baseline, publicationReview: { schemaVersion: 1,
      authorization: 'public-contribution', reviewed: true, containsPrivateData: false,
      contentSha256: inspected.disclosure.contentSha256 } };
  };
  const example = 'verified-capability-contribution';
  const candidate = await prepare(example);
  const green = await verifyContribution(candidate);
  assert.equal(green.status, 'verified'); assert.equal(green.verifiedContribution, true);
  checks.push('new-capability-verified');
  const reference = await verifyContribution(await prepare('verified-website-reference-contribution'));
  assert.equal(reference.status, 'verified'); checks.push('reference-verified');
  const fix = await prepare(example, async (dir) => {
    const metadataPath = path.join(dir, 'contribution.json');
    const definitionPath = path.join(dir, 'capability.json');
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
    const definition = JSON.parse(await fs.readFile(definitionPath, 'utf8'));
    metadata.changeType = 'capability-fix'; definition.id = metadata.base.capabilityId; definition.version = '0.1.2';
    await fs.writeFile(metadataPath, JSON.stringify(metadata));
    await fs.writeFile(definitionPath, JSON.stringify(definition));
  });
  assert.equal((await verifyContribution(fix)).status, 'verified'); checks.push('capability-fix-verified');
  for (const [label, mutate] of [
    ['failed-test', (dir) => fs.appendFile(path.join(dir, 'adapter.test.mjs'), "\ntest('broken',()=>{throw new Error('SYNTHETIC_FAILURE');});")],
    ['skipped-test', (dir) => fs.appendFile(path.join(dir, 'adapter.test.mjs'), "\ntest.skip('not-evidence',()=>{});")],
    ['wrong-fixture', (dir) => fs.writeFile(path.join(dir, 'new.html'), '<card data-href="/records/wrong">Wrong title</card>')]
  ]) {
    const receipt = await verifyContribution(await prepare(example, mutate));
    assert.equal(receipt.status, 'rejected'); assert.equal(receipt.verifiedContribution, false);
    checks.push(`${label}-rejected`);
  }
  const repaired = await verifyContribution(candidate);
  assert.equal(repaired.status, 'verified'); checks.push('repaired-contribution-verified');
  const intake = { ...candidate, storeDir: path.join(root, 'intake') };
  const first = await receiveContribution(intake);
  const duplicate = await receiveContribution(intake);
  assert.equal(first.verification.status, 'verified'); assert.equal(duplicate.duplicate, true);
  const status = await getContributionStatus({ storeDir: intake.storeDir, contributionKey: first.contributionKey });
  assert.equal(status.events.length, 1); assert.equal(status.reusable, false);
  checks.push('verified-intake-idempotent-not-adopted');
  console.log(JSON.stringify({ ok: true, status: 'passed', checks }));
} catch (error) {
  const reason = /^[A-Z][A-Z0-9_]{0,79}$/.test(error?.message || '') ? error.message : 'ISOLATION_ACCEPTANCE_FAILED';
  console.log(JSON.stringify({ ok: false, status: error.blocked ? 'blocked' : 'failed', reason, completedChecks: checks }));
  process.exitCode = 1;
} finally {
  if (listener) await new Promise((resolve) => listener.close(resolve));
}
