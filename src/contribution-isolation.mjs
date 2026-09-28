import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const blocked = (reason) => ({ ok: false, status: 'blocked', reason });
const TARGETS = new Set(['/candidate', '/baseline', '/runner']);

// Internal controller transport. Mount sources and node arguments must be built
// by the trusted verifier, never copied from a contribution's arbitrary command.
// Requires a preinstalled, explicitly selected content-addressed Linux image.
export async function runIsolatedNode({ image, mounts, args, input = '', timeoutMs = 15000 } = {}) {
  if (typeof image !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(image)) return blocked('PINNED_LOCAL_IMAGE_REQUIRED');
  if (!Array.isArray(mounts) || !mounts.length || mounts.length > 3 ||
    new Set(mounts.map((m) => m?.target)).size !== mounts.length ||
    !Array.isArray(args) || !args.length || args.some((a) => typeof a !== 'string' || a.includes('\0')) ||
    !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000 ||
    typeof input !== 'string' || Buffer.byteLength(input) > 2 * 1024 * 1024) return blocked('ISOLATION_INPUT_INVALID');
  const bindArgs = [];
  try {
    for (const mount of mounts) {
      if (!TARGETS.has(mount.target) || typeof mount.source !== 'string' || !path.isAbsolute(mount.source) ||
        /[,\r\n\0]/.test(mount.source)) return blocked('ISOLATION_MOUNT_INVALID');
      const stat = await fs.lstat(mount.source);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return blocked('ISOLATION_MOUNT_INVALID');
      const source = await fs.realpath(mount.source);
      if (/[,\r\n\0]/.test(source)) return blocked('ISOLATION_MOUNT_INVALID');
      bindArgs.push('--mount', `type=bind,source=${source},target=${mount.target},readonly`);
    }
  } catch { return blocked('ISOLATION_MOUNT_INVALID'); }
  // Never load the caller's Docker config, registry credentials or remote context.
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'contribution-docker-config-'));
  const env = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  const invoke = (parameters, extra = {}) => spawnSync('docker', ['--config', configDir, ...parameters], {
    shell: false, windowsHide: true, env, encoding: 'utf8', timeout: 10000,
    maxBuffer: 2 * 1024 * 1024, killSignal: 'SIGKILL', ...extra
  });
  const engine = invoke(['info', '--format', '{{.OSType}}']);
  if (engine.error || engine.status !== 0 || engine.stdout.trim() !== 'linux') return blocked('LINUX_CONTAINER_ENGINE_UNAVAILABLE');
  const selected = invoke(['image', 'inspect', '--format', '{{.Id}} {{.Os}}', image]);
  if (selected.error || selected.status !== 0 || selected.stdout.trim() !== `${image} linux`) return blocked('PINNED_LOCAL_IMAGE_UNAVAILABLE');
  const name = `web-contribution-${randomUUID()}`;
  const execution = invoke(['run', '--rm', '--pull=never', '--name', name,
    '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '--user=65534:65534', '--pids-limit=64', '--memory=512m', '--memory-swap=512m', '--cpus=1',
    '--ulimit', 'nofile=256:256', '--tmpfs', '/tmp:rw,noexec,nosuid,size=67108864,mode=1777',
    '--workdir=/tmp', ...bindArgs, '--entrypoint=node', '-i', image, ...args],
  { input, timeout: timeoutMs });
  if (execution.error || execution.signal) {
    // A killed Docker client does not guarantee the container stopped. Remove
    // only this controller-generated exact name; never enumerate user containers.
    const removed = invoke(['rm', '--force', name]);
    return { ok: false, status: 'rejected', reason: removed.error || removed.status !== 0 ? 'CONTAINER_CLEANUP_UNCONFIRMED' : 'ISOLATED_EXECUTION_LIMIT' };
  }
  if (execution.status !== 0) return { ok: false, status: 'rejected', reason: 'ISOLATED_EXECUTION_FAILED' };
  // Raw stdout is private working data for host-side comparison, never a public
  // acceptance receipt. stderr is intentionally discarded, including on error.
  return { ok: true, status: 'executed', stdout: execution.stdout };
}
