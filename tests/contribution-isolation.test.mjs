import assert from 'node:assert/strict';
import test from 'node:test';
import { runIsolatedNode } from '../src/contribution-isolation.mjs';

test('isolation refuses floating or absent images without attempting candidate execution', async () => {
  for (const image of [undefined, 'node:22', 'attacker.test/image:latest', 'sha256:invalid']) {
    const result = await runIsolatedNode({ image });
    assert.equal(result.status, 'blocked');
    assert.equal(result.reason, 'PINNED_LOCAL_IMAGE_REQUIRED');
    assert.equal(Object.hasOwn(result, 'stdout'), false);
  }
});

test('malformed isolation mounts cannot widen access to host paths', async () => {
  const image = `sha256:${'0'.repeat(64)}`;
  for (const mounts of [[], [{ source: '.', target: '/candidate' }],
    [{ source: 'C:\\', target: '/host' }]]) {
    const result = await runIsolatedNode({ image, mounts, args: ['/runner/case.mjs'] });
    assert.equal(result.status, 'blocked');
    assert.equal(Object.hasOwn(result, 'stdout'), false);
  }
});
