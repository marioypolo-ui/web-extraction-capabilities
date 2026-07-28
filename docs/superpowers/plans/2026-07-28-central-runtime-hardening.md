# Central Runtime Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release v0.1.3 with precise unresolved-action diagnostics, standalone Bundle validation, and isolated immutable Bundle runtime instances.

**Architecture:** Keep source-catalog validation and runtime-Bundle validation as separate trust boundaries. Add focused Bundle validation and runtime-loader modules, expose them through the existing public API and CLI, and make the static HTML parser suppress only controls positively identified as navigation while preserving diagnostics for possible records.

**Tech Stack:** Node.js 22+ ESM, `node:test`, `node:assert`, Node built-ins (`fs/promises`, `crypto`, `path`, `url`), GitHub Actions.

## Global Constraints

- Priority is no missed records and no silent failure before reducing false positives.
- Do not add site-specific suppression for Guangxi University of Science and Technology.
- Do not add CAPTCHA, slider, login, or browser-security bypasses.
- Do not add tender, Feishu, scheduling, keyword, date-filtering, or update-policy logic.
- Domestic Chinese government, government-department, and public-institution targets must use a direct connection even when `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, or a global proxy is configured.
- Consuming applications own route enforcement: they must bypass proxies with an explicit direct dispatcher or complete `NO_PROXY` coverage, must not silently fall back to a proxy, and must diagnose direct-route failures.
- Source `validate` remains strict about source-only fixtures, tests, and evidence.
- Runtime Bundle validation must work without source-only fixtures and tests.
- Bundle directories are immutable after loading; consumers use a new directory for every candidate version.
- New behavior requires tests; skipped and todo tests are forbidden.
- Release version is `0.1.3`; Bundle format remains `1`.

## File Structure

- `src/static-html.mjs`: classify unresolved action-only blocks and emit diagnostics only for possible records.
- `src/bundle-validation.mjs`: read and validate a released Bundle manifest, paths, files, hashes, format, and required entry points.
- `src/bundle.mjs`: build a Bundle with the library version and validate the completed output.
- `src/bundle-runtime.mjs`: load one validated immutable Bundle directory and expose only its public runtime API.
- `src/index.mjs`: export the new validation and runtime factory APIs.
- `bin/web-extract.mjs`: add `bundle:validate`.
- `tests/extract.test.mjs`: cover navigation-control suppression and preservation of possible-record diagnostics.
- `tests/bundle-validation.test.mjs`: cover Bundle trust-boundary failures.
- `tests/bundle-runtime.test.mjs`: cover independent current/candidate runtimes and failure isolation.
- `tests/bundle.test.mjs`, `tests/cli.test.mjs`: cover build-time validation, generated-Bundle CLI use, and release version.
- `.github/workflows/ci.yml`, `.github/workflows/release-candidate.yml`, `.github/workflows/release.yml`: validate generated artifacts before packaging or publishing.
- `package.json`, `package-lock.json`, `src/result.mjs`: keep the release version synchronized.
- `README.md`, `README.en.md`, `docs/integration.md`, `docs/upgrades.md`, `docs/diagnostics.md`, `PROGRESS.md`: document the new public contract and v0.1.3 change.

---

### Task 1: Make Action-Link Diagnostics Record-Aware

**Files:**
- Modify: `tests/extract.test.mjs`
- Modify: `src/static-html.mjs`

**Interfaces:**
- Consumes: `extract({ capabilityId, url, html, config })`.
- Produces: unchanged extraction result shape; `ACTION_LINK_REQUIRES_CONFIGURATION` remains the diagnostic code for unresolved possible-record actions.

- [ ] **Step 1: Add failing navigation and record-risk tests**

Append tests that use HTML entities for the Chinese UI labels so the fixture remains ASCII:

```js
test('action-only pagination and mobile controls do not produce record diagnostics', async () => {
  const result = await extract({
    capabilityId: 'static-html-list',
    url: 'https://example.test/notices',
    html: `
      <ul>
        <li><a href="javascript:void(0)" onclick="_vsb_multiscreen.setDevice('mobile')">&#x624B;&#x673A;&#x7248;</a></li>
        <li><a href="javascript:;" onclick="_simple_list_gotopage_fun(2)">&#x8DF3;&#x8F6C;</a></li>
        <li><a href="#" onclick="goPage(1)">&#x9996;&#x9875;</a></li>
      </ul>`
  });

  assert.equal(
    result.diagnostics.some((item) => item.code === 'ACTION_LINK_REQUIRES_CONFIGURATION'),
    false
  );
  assert.ok(result.diagnostics.some((item) => item.code === 'ZERO_RECORDS'));
});

test('action-only blocks with record evidence remain diagnosed', async () => {
  const cases = [
    '<li><time datetime="2026-07-28"></time><a href="javascript:;" onclick="goPage(2)">Dated notice</a></li>',
    '<li><a href="javascript:;" data-id="notice-42">Data notice</a></li>',
    '<li><a href="javascript:;" onclick="openNotice(42)">Open notice</a></li>',
    '<li><a href="javascript:;" onclick="goPage(42)">Unknown but titled notice</a></li>',
    '<li><a href="javascript:;" onclick="customAction()">Unknown but titled notice</a></li>'
  ];

  for (const html of cases) {
    const result = await extract({
      capabilityId: 'static-html-list',
      url: 'https://example.test/notices',
      html: `<ul>${html}</ul>`
    });
    assert.ok(
      result.diagnostics.some((item) => item.code === 'ACTION_LINK_REQUIRES_CONFIGURATION'),
      html
    );
  }
});
```

- [ ] **Step 2: Run the focused test and confirm the false positive**

Run:

```powershell
node --test tests/extract.test.mjs
```

Expected: the navigation-control test fails because the current parser emits `ACTION_LINK_REQUIRES_CONFIGURATION`.

- [ ] **Step 3: Add minimal structural classification**

In `src/static-html.mjs`, add these private patterns and helper:

```js
const NAVIGATION_TITLE_PATTERN =
  /^(?:mobile version|\u624b\u673a\u7248|jump|\u8df3\u8f6c|first|first page|\u9996\u9875|previous|prev|previous page|\u4e0a\u4e00\u9875|next|next page|\u4e0b\u4e00\u9875|last|last page|\u5c3e\u9875|\u672b\u9875|\u7b2c?\s*\d+\s*\u9875|\d+)$/i;
const PAGINATION_HANDLER_PATTERN =
  /(?:^|[.\s_])(go|goto|change|turn|jump|set|simple_list_goto)?page(?:_fun)?\s*\(|_simple_list_gotopage_fun\s*\(/i;
const CONTENT_HANDLER_PATTERN = /(?:open|show|view|detail|article|notice)\w*\s*\(/i;

function isNavigationActionControl({ block, attributes, title }) {
  const handler = attribute(attributes, 'onclick');
  const hasTime = /<time\b/i.test(block);
  const hasDate = Boolean(parseLikelyPublicationDate(textContent(block)));
  const hasDataId = Boolean(
    attribute(attributes, 'data-id') ||
      attribute(block.match(/^<[^>]+/i)?.[0] || '', 'data-id')
  );
  const hasContentHandler = CONTENT_HANDLER_PATTERN.test(handler);
  const hasRecordMetadata = hasTime || hasDate || hasDataId || hasContentHandler;

  if (hasRecordMetadata) {
    return false;
  }
  return (
    NAVIGATION_TITLE_PATTERN.test(title) ||
    (!title && PAGINATION_HANDLER_PATTERN.test(handler))
  );
}
```

Move `const title = chooseTitle(attributes, anchor[2]);` before unresolved-action handling. When `resolveActionUrl` returns an empty string, skip only when `isNavigationActionControl(...)` returns `true`; otherwise preserve the existing diagnostic and continue. Valid `href` links with analytics `onclick` attributes must not enter this branch.

- [ ] **Step 4: Run focused parser tests**

Run:

```powershell
node --test tests/extract.test.mjs
```

Expected: all extraction tests pass; pagination/mobile controls have only `ZERO_RECORDS`, while all four possible-record cases retain `ACTION_LINK_REQUIRES_CONFIGURATION`.

**Post-implementation precision update (verified on the current branch):**

- Record evidence (`<time>`, a parsed publication date, `data-id`, or a content
  handler) always takes priority and preserves
  `ACTION_LINK_REQUIRES_CONFIGURATION`, even inside navigation containers.
- Without record evidence, empty controls and known paging/mobile controls may be
  ignored.
- Without record evidence, controls may also be ignored when they are inside
  `<nav>` or a `class`/`id`/`role` context containing an independent
  `nav`/`navigation`/`menu`/`header`/`breadcrumb`/`pagination`/`pager` token.
  The context check includes the current `<li>` or `<article>` root as well as its
  ancestors.
- Structural ancestry masks only complete, closed HTML comments and replaces
  them with equal-length spaces to preserve indexes. Comment pseudo-tags cannot
  become ancestors, and an unclosed `<!--` marker does not consume later DOM.
- These are generic structural rules. No GXUST-specific suppression or
  classification was added.

- [ ] **Step 5: Commit the diagnostic fix**

```powershell
git add src/static-html.mjs tests/extract.test.mjs
git commit -m "fix: distinguish action records from page controls"
```

---

### Task 2: Validate Runtime Bundles Independently

**Files:**
- Create: `src/bundle-validation.mjs`
- Create: `tests/bundle-validation.test.mjs`
- Modify: `src/bundle.mjs`
- Modify: `src/index.mjs`
- Modify: `bin/web-extract.mjs`
- Modify: `tests/bundle.test.mjs`
- Modify: `tests/cli.test.mjs`

**Interfaces:**
- Produces: `validateBundle({ bundleDir, expectedVersion? }) -> Promise<manifest>`.
- Produces: CLI `web-extract bundle:validate --bundle <directory> [--expected-version <version>]`.
- `buildBundle({ outputDir })` still returns the manifest, but validates the written Bundle before returning.

- [ ] **Step 1: Add failing Bundle validation tests**

Create `tests/bundle-validation.test.mjs` with a helper that calls `buildBundle` into a temporary directory and tests:

```js
test('generated runtime bundle validates without source fixtures or tests', async () => {
  const bundleDir = await makeBundle();
  const manifest = await validateBundle({ bundleDir, expectedVersion: LIBRARY_VERSION });

  assert.equal(manifest.bundleFormatVersion, 1);
  assert.equal(manifest.version, LIBRARY_VERSION);
  await assert.rejects(fs.access(path.join(bundleDir, 'fixtures')));
  await assert.rejects(fs.access(path.join(bundleDir, 'tests')));
});
```

Add mutation tests that rewrite `bundle-manifest.json` and assert rejection messages for:

```js
await assert.rejects(
  validateBundle({ bundleDir }),
  /unsupported bundle format/i
);
await assert.rejects(
  validateBundle({ bundleDir }),
  /unsafe bundle path/i
);
await assert.rejects(
  validateBundle({ bundleDir }),
  /duplicate bundle path/i
);
await assert.rejects(
  validateBundle({ bundleDir }),
  /SHA256 mismatch/i
);
await assert.rejects(
  validateBundle({ bundleDir }),
  /required runtime entry point/i
);
```

Use `../outside.mjs` for traversal, repeat an existing file entry for duplication, alter one copied file for SHA mismatch, set `bundleFormatVersion` to `2`, and remove the `src/index.mjs` entry for the missing-entry test. Add an optional symlink rejection test guarded only by platform capability: create the link in a `try`, run the assertion if creation succeeds, and return normally on Windows privilege error without using `test.skip`.

- [ ] **Step 2: Run the new test and confirm the API is missing**

Run:

```powershell
node --test tests/bundle-validation.test.mjs
```

Expected: FAIL because `validateBundle` is not exported.

- [ ] **Step 3: Implement manifest and file validation**

Create `src/bundle-validation.mjs` with:

```js
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REQUIRED_FILES = ['package.json', 'src/index.mjs', 'bin/web-extract.mjs'];

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function requireString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Bundle manifest field must be a non-empty string: ${field}`);
  }
}

function assertSafePath(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\\') ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    path.posix.normalize(value) !== value ||
    value.split('/').includes('..')
  ) {
    throw new Error(`Unsafe bundle path: ${String(value)}`);
  }
}

async function lstatBundleFile(bundleDir, relativePath) {
  let current = bundleDir;
  for (const segment of relativePath.split('/')) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`Bundle links are not allowed: ${relativePath}`);
    }
  }
  const stat = await fs.lstat(current);
  if (!stat.isFile()) {
    throw new Error(`Bundle entry is not a file: ${relativePath}`);
  }
  return current;
}

export async function readBundleManifest(bundleDir) {
  if (!bundleDir) {
    throw new Error('bundleDir is required');
  }
  const absoluteBundleDir = path.resolve(bundleDir);
  const rootStat = await fs.lstat(absoluteBundleDir);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error('Bundle directory must be a real directory');
  }
  const manifestPath = path.join(absoluteBundleDir, 'bundle-manifest.json');
  const manifestStat = await fs.lstat(manifestPath);
  if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) {
    throw new Error('Bundle manifest must be a real file');
  }
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Bundle manifest must be an object');
  }
  return manifest;
}

export async function validateBundle({ bundleDir, expectedVersion } = {}) {
  const absoluteBundleDir = path.resolve(bundleDir || '');
  const manifest = await readBundleManifest(bundleDir);

  if (manifest.bundleFormatVersion !== 1) {
    throw new Error(`Unsupported bundle format: ${manifest.bundleFormatVersion}`);
  }
  requireString(manifest.name, 'name');
  requireString(manifest.version, 'version');
  if (expectedVersion && manifest.version !== expectedVersion) {
    throw new Error(
      `Bundle version ${manifest.version} does not match expected version ${expectedVersion}`
    );
  }
  if (!SHA256_PATTERN.test(manifest.bundleSha256 || '')) {
    throw new Error('Bundle manifest has an invalid bundleSha256');
  }
  if (!SHA256_PATTERN.test(manifest.catalogSha256 || '')) {
    throw new Error('Bundle manifest has an invalid catalogSha256');
  }
  if (!Array.isArray(manifest.capabilities) || !Array.isArray(manifest.files)) {
    throw new Error('Bundle manifest capabilities and files must be arrays');
  }

  for (const capability of manifest.capabilities) {
    for (const field of ['id', 'version', 'status', 'scope']) {
      requireString(capability?.[field], `capabilities[].${field}`);
    }
    if (!Array.isArray(capability.verifiedTargets)) {
      throw new Error('Bundle capability verifiedTargets must be an array');
    }
  }

  const seen = new Set();
  const verifiedFiles = [];
  for (const entry of manifest.files) {
    assertSafePath(entry?.path);
    if (seen.has(entry.path)) {
      throw new Error(`Duplicate bundle path: ${entry.path}`);
    }
    seen.add(entry.path);
    if (!SHA256_PATTERN.test(entry.sha256 || '')) {
      throw new Error(`Bundle entry has an invalid SHA256: ${entry.path}`);
    }
    const file = await lstatBundleFile(absoluteBundleDir, entry.path);
    const actualSha256 = sha256(await fs.readFile(file));
    if (actualSha256 !== entry.sha256) {
      throw new Error(`Bundle file SHA256 mismatch: ${entry.path}`);
    }
    verifiedFiles.push({ path: entry.path, sha256: entry.sha256 });
  }

  for (const required of REQUIRED_FILES) {
    if (!seen.has(required)) {
      throw new Error(`Missing required runtime entry point: ${required}`);
    }
  }

  verifiedFiles.sort((left, right) => left.path.localeCompare(right.path));
  if (sha256(JSON.stringify(verifiedFiles)) !== manifest.bundleSha256) {
    throw new Error('Bundle aggregate SHA256 mismatch');
  }
  return manifest;
}
```

The implementation must:

1. require `bundleDir` and resolve it to an absolute path;
2. parse `bundle-manifest.json` as an object;
3. require `bundleFormatVersion === 1`;
4. require non-empty string `name` and `version`, and enforce `expectedVersion` when supplied;
5. require 64-character lowercase hex `bundleSha256` and `catalogSha256`;
6. require `capabilities` and `files` arrays and validate each capability summary as `{ id, version, status, scope, verifiedTargets: [] }`;
7. reject empty, absolute, backslash-containing, traversal, duplicate, or non-normalized file paths;
8. resolve every path under `bundleDir`, use `lstat`, reject symbolic links and non-files, read content, and compare SHA256;
9. require `package.json`, `src/index.mjs`, and `bin/web-extract.mjs`;
10. sort `{ path, sha256 }` entries by path and verify `sha256(JSON.stringify(sortedFiles)) === bundleSha256`.

Export only `validateBundle` from `src/index.mjs`; keep `readBundleManifest` internal to the runtime loader.

- [ ] **Step 4: Make Bundle generation version-safe and self-validating**

In `src/bundle.mjs`:

```js
import { validateBundle } from './bundle-validation.mjs';
import { LIBRARY_VERSION } from './result.mjs';
```

Replace the hard-coded manifest version with `LIBRARY_VERSION`. After writing `bundle-manifest.json`, call:

```js
await validateBundle({ bundleDir: outputDir, expectedVersion: LIBRARY_VERSION });
```

Then return the original manifest.

- [ ] **Step 5: Add CLI support and generated-Bundle coverage**

Import `validateBundle` in `bin/web-extract.mjs` and add:

```js
if (command === 'bundle:validate') {
  return validateBundle({
    bundleDir: path.resolve(options.bundle || ''),
    expectedVersion: options.expectedVersion
  });
}
```

In `tests/cli.test.mjs`, build a temporary Bundle, then execute the CLI from inside that Bundle:

```js
const bundledCli = path.join(output, 'bin', 'web-extract.mjs');
const validation = spawnSync(
  process.execPath,
  [
    bundledCli,
    'bundle:validate',
    '--bundle',
    output,
    '--expected-version',
    LIBRARY_VERSION
  ],
  { encoding: 'utf8' }
);
assert.equal(validation.status, 0, validation.stderr);
assert.equal(JSON.parse(validation.stdout).version, LIBRARY_VERSION);
```

Update existing literal `0.1.2` Bundle assertions to use `LIBRARY_VERSION`. In `tests/bundle.test.mjs`, call `validateBundle` on the output and assert it returns the same `bundleSha256`.

- [ ] **Step 6: Run Bundle and CLI tests**

Run:

```powershell
node --test tests/bundle-validation.test.mjs tests/bundle.test.mjs tests/cli.test.mjs
```

Expected: all tests pass, including CLI execution from a Bundle that has no source fixtures or tests.

- [ ] **Step 7: Commit Bundle validation**

```powershell
git add src/bundle-validation.mjs src/bundle.mjs src/index.mjs bin/web-extract.mjs tests/bundle-validation.test.mjs tests/bundle.test.mjs tests/cli.test.mjs
git commit -m "feat: validate standalone runtime bundles"
```

---

### Task 3: Load Immutable Bundle Runtimes in Isolation

**Files:**
- Create: `src/bundle-runtime.mjs`
- Create: `tests/bundle-runtime.test.mjs`
- Modify: `src/index.mjs`

**Interfaces:**
- Consumes: `validateBundle({ bundleDir, expectedVersion? })`.
- Produces: `createBundleRuntime({ bundleDir, expectedVersion?, validate? }) -> Promise<Readonly<BundleRuntime>>`.
- `BundleRuntime` exposes metadata plus `getCatalog`, `findCapabilitiesForUrl`, `detectCapabilities`, `extract`, `fetchResource`, and `normalizeUrl`.

- [ ] **Step 1: Add failing runtime-isolation tests**

Create `tests/bundle-runtime.test.mjs`. Build two Bundles into different absolute directories and assert:

```js
const current = await createBundleRuntime({
  bundleDir: currentDir,
  expectedVersion: LIBRARY_VERSION
});
const candidate = await createBundleRuntime({
  bundleDir: candidateDir,
  expectedVersion: LIBRARY_VERSION
});

assert.notEqual(current.bundleDir, candidate.bundleDir);
assert.equal(Object.isFrozen(current), true);
assert.equal(current.version, LIBRARY_VERSION);
assert.equal(candidate.version, LIBRARY_VERSION);

const currentResult = await current.extract(staticInput);
const candidateResult = await candidate.extract(staticInput);
assert.deepEqual(currentResult, candidateResult);
assert.notEqual(current.extract, candidate.extract);
```

Corrupt a third Bundle after creation and verify failure isolation:

```js
await assert.rejects(
  createBundleRuntime({ bundleDir: brokenDir }),
  /SHA256 mismatch/i
);
assert.equal((await current.extract(staticInput)).records.length, 2);
```

Add an expected-version mismatch assertion and a `validate: false` smoke assertion. The latter may load only a trusted locally built Bundle and still must verify that the imported module version equals the manifest version.

- [ ] **Step 2: Run the runtime test and confirm the factory is missing**

Run:

```powershell
node --test tests/bundle-runtime.test.mjs
```

Expected: FAIL because `createBundleRuntime` is not exported.

- [ ] **Step 3: Implement the isolated loader**

Create `src/bundle-runtime.mjs`:

```js
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { readBundleManifest, validateBundle } from './bundle-validation.mjs';

const REQUIRED_APIS = [
  'getCatalog',
  'findCapabilitiesForUrl',
  'detectCapabilities',
  'extract',
  'fetchResource',
  'normalizeUrl'
];

export async function createBundleRuntime({
  bundleDir,
  expectedVersion,
  validate = true
} = {}) {
  if (!bundleDir) {
    throw new Error('bundleDir is required');
  }
  const absoluteBundleDir = path.resolve(bundleDir);
  const manifest = validate
    ? await validateBundle({ bundleDir: absoluteBundleDir, expectedVersion })
    : await readBundleManifest(absoluteBundleDir);
  if (expectedVersion && manifest.version !== expectedVersion) {
    throw new Error(
      `Bundle version ${manifest.version} does not match expected version ${expectedVersion}`
    );
  }
  const moduleUrl = pathToFileURL(path.join(absoluteBundleDir, 'src', 'index.mjs')).href;
  const runtimeModule = await import(moduleUrl);

  if (runtimeModule.LIBRARY_VERSION !== manifest.version) {
    throw new Error(
      `Bundle module version ${runtimeModule.LIBRARY_VERSION} does not match manifest ${manifest.version}`
    );
  }
  for (const api of REQUIRED_APIS) {
    if (typeof runtimeModule[api] !== 'function') {
      throw new Error(`Bundle runtime API is missing: ${api}`);
    }
  }

  return Object.freeze({
    version: manifest.version,
    bundleFormatVersion: manifest.bundleFormatVersion,
    catalogSha256: manifest.catalogSha256,
    bundleDir: absoluteBundleDir,
    ...Object.fromEntries(REQUIRED_APIS.map((api) => [api, (...args) => runtimeModule[api](...args)]))
  });
}
```

Do not expose the imported module object. Do not add cache-busting query strings: different immutable absolute directories already produce distinct ESM instances.

- [ ] **Step 4: Export and verify the factory**

Export `createBundleRuntime` from `src/index.mjs`, then run:

```powershell
node --test tests/bundle-runtime.test.mjs
```

Expected: both runtime directories work independently, the returned objects are frozen, and a broken candidate does not affect the current runtime.

- [ ] **Step 5: Commit the runtime factory**

```powershell
git add src/bundle-runtime.mjs src/index.mjs tests/bundle-runtime.test.mjs
git commit -m "feat: load isolated bundle runtimes"
```

---

### Task 4: Release v0.1.3 and Verify the Real Regression

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/result.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release-candidate.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `docs/integration.md`
- Modify: `docs/upgrades.md`
- Modify: `docs/diagnostics.md`
- Modify: `PROGRESS.md`
- Modify: tests containing literal capability version assertions

**Interfaces:**
- Release version: `0.1.3`.
- CI validates both the source repository and generated runtime artifact.
- Consumer guidance uses immutable version directories and explicit candidate validation.

- [ ] **Step 1: Add a version-consistency assertion**

In `tests/bundle.test.mjs`, read `package.json` and assert:

```js
assert.equal(packageJson.version, LIBRARY_VERSION);
assert.equal(first.version, LIBRARY_VERSION);
```

Update extraction tests that assert `capabilityVersion` from `0.1.2` to `0.1.3`.

- [ ] **Step 2: Update all release-version sources**

Set `"version": "0.1.3"` in `package.json` and the root package entries in `package-lock.json`. Set:

```js
export const LIBRARY_VERSION = '0.1.3';
```

in `src/result.mjs`. Search for stale release literals:

```powershell
rg -n "0\.1\.2" package.json package-lock.json src tests bin docs README.md README.en.md PROGRESS.md .github
```

Any remaining `0.1.2` must be intentional historical upgrade text; active examples and assertions must use `0.1.3`.

- [ ] **Step 3: Validate generated Bundles in CI and release workflows**

After each `bundle` command in all three workflows, run the Bundle's own CLI:

```yaml
- run: >-
    node dist/web-extraction-capabilities/bin/web-extract.mjs
    bundle:validate
    --bundle dist/web-extraction-capabilities
    --expected-version 0.1.3
```

For `ci.yml`, use the actual temporary Bundle paths and validate both reproducibility outputs before comparing `bundleSha256`. Artifact packaging and publication must remain after successful Bundle validation.

- [ ] **Step 4: Document the public contract**

Update both READMEs and `docs/integration.md` with a minimal example:

```js
import { createBundleRuntime } from './web-extraction-capabilities/src/index.mjs';

const candidate = await createBundleRuntime({
  bundleDir: 'vendor/web-extraction-capabilities/0.1.3',
  expectedVersion: '0.1.3'
});
```

Document:

- one version per immutable directory;
- current and candidate can coexist for application-owned comparison;
- central validation does not decide application fallback or promotion;
- `bundle:validate` is for released artifacts, while `validate` is for a source checkout;
- candidate creation failure leaves the already-loaded current runtime usable.
- Chinese government, government-department, and public-institution targets require direct routing even when `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, or a global system proxy exists;
- each consuming application must enforce direct routing with an explicit direct dispatcher or complete `NO_PROXY` coverage, must never silently fall back to a proxy, and must emit a diagnostic when the direct route fails;
- the central library cannot guarantee route selection when a consumer replaces the process-global dispatcher, so route enforcement is an application integration responsibility.

In `docs/diagnostics.md`, explain that `ACTION_LINK_REQUIRES_CONFIGURATION` applies to plausible records, while explicit paging/mobile controls are ignored. Also document a direct-route failure as an application-visible fetch diagnostic rather than a reason to retry through a proxy. In `docs/upgrades.md`, record the v0.1.3 upgrade steps, compatibility, and a consumer checklist item that verifies proxy bypass for every configured Chinese government/public-institution host. In `PROGRESS.md`, record completion and verification evidence without claiming publication before the tag/release actually exists.

- [ ] **Step 5: Run the fastest focused verification**

Run:

```powershell
node --test tests/extract.test.mjs tests/bundle-validation.test.mjs tests/bundle-runtime.test.mjs tests/bundle.test.mjs tests/cli.test.mjs
```

Expected: all focused tests pass.

- [ ] **Step 6: Run the full local quality gate**

Run:

```powershell
npm test
npm run validate
npm run docs:smoke
npm run audit:sensitive
npm run bundle
node dist/bundle/bin/web-extract.mjs bundle:validate --bundle dist/bundle --expected-version 0.1.3
```

Expected: every command exits `0`; no tests are skipped or todo; the final JSON reports version `0.1.3` and Bundle format `1`.

- [x] **Step 7: Regress the Guangxi University of Science and Technology page**

Historical verification procedure: fetch the live page through the repository's approved web-access workflow with direct domestic routing, save it only under the system temporary directory, then run the v0.1.3 static extraction against:

```text
https://www.gxust.edu.cn/xwzx/zbgs.htm
```

Verification criteria:

- ordinary announcement links still produce records;
- the record count is not lower than the pre-fix observed count of `10`;
- neither `手机版` nor pagination `跳转` emits `ACTION_LINK_REQUIRES_CONFIGURATION`;
- any unrelated unresolved possible-record action remains visible as a diagnostic;
- no live HTML, credentials, cookies, or IP configuration is committed.

Verified by the control agent on 2026-07-28:

- `curl.exe --noproxy "*"` fetched the page by a direct route into the system
  temporary directory; the response was `27,030` bytes.
- Current v0.1.3 HEAD produced `52` total records, including `10` dated
  announcement records.
- The first three announcements had normal titles, URLs, and publication dates.
- Extraction emitted `0` `ACTION_LINK_REQUIRES_CONFIGURATION` diagnostics and
  the diagnostics array was empty.
- The live page reported no unrelated unresolved possible-record action; existing
  synthetic regressions continue to verify that record evidence preserves the
  diagnostic.
- No live HTML, IP configuration, Cookie, or credential was committed.

- [ ] **Step 8: Commit release readiness**

```powershell
git add package.json package-lock.json src/result.mjs .github/workflows/ci.yml .github/workflows/release-candidate.yml .github/workflows/release.yml README.md README.en.md docs/integration.md docs/upgrades.md docs/diagnostics.md PROGRESS.md tests
git commit -m "chore: prepare v0.1.3 release"
```

- [ ] **Step 9: Review the complete branch diff**

Run:

```powershell
git status --short
git diff --check main...HEAD
git diff --stat main...HEAD
git log --oneline --decorate main..HEAD
```

Expected: the worktree is clean, `git diff --check` is silent, and every changed file traces to the approved design.

## Success Criteria

- Verified on 2026-07-28: the GXUST direct-route regression produced `52` total
  records and `10` dated announcement records with `0`
  `ACTION_LINK_REQUIRES_CONFIGURATION` diagnostics and an empty diagnostics
  array.
- Possible announcement actions still emit `ACTION_LINK_REQUIRES_CONFIGURATION`.
- A generated Bundle validates independently without source-only fixtures or tests.
- Corruption, unsafe paths, links, format mismatch, and missing runtime entries fail explicitly.
- Two immutable Bundle directories can be loaded and compared in one process.
- A failed candidate load does not break the current runtime.
- Version, docs, CI, and release artifacts consistently identify v0.1.3.
- Integration guidance makes proxy bypass mandatory for Chinese government/public-institution sites and forbids silent proxy fallback.
- Full tests, source validation, docs smoke, sensitive audit, Bundle generation,
  standalone Bundle validation, and the live GXUST regression have passed
  locally. This is release-readiness evidence, not a claim that v0.1.3 has been
  tagged or published.
