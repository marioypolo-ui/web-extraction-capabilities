# Web Extraction Capabilities

An executable catalog of reusable website detection, extraction, diagnostics, fixtures, and tests. Applications keep ownership of business filtering, storage, credentials, scheduling, and notifications.

## Guarantees

- Fetch failures, zero records, dynamic rendering, login, human verification, and missing dependencies are explicit diagnostics.
- CAPTCHA and slider challenges are detected, never bypassed.
- Credentials, cookies, tokens, and browser profiles remain in the consuming application.
- Applications vendor a versioned bundle and continue running without this repository or network access.

## Quick start

```powershell
npm ci
npm test
node bin/web-extract.mjs catalog
node bin/web-extract.mjs detect --url "https://example.test/notices" --html-file fixtures/static-list.html
node bin/web-extract.mjs extract --capability static-html-list --url "https://example.test/notices/" --html-file fixtures/static-list.html
node bin/web-extract.mjs bundle --output dist/bundle
```

See [Integration](docs/integration.md), [Diagnostics](docs/diagnostics.md), [Capability authoring](docs/capability-authoring.md), and [Upgrades](docs/upgrades.md).

Use `node bin/web-extract.mjs catalog --url "<url>"` to find verified website references. Reusable references can guide automatic routing; reported-only references never control it.

## Real-world usage and project evidence

As of `v0.1.3`, the catalog contains 11 machine-readable capability classes, 14 public website references backed by live tests or sanitized fixtures, and one reported-only reference for human-verification risk. Release gates include 122 automated tests, and GitHub Releases ship standalone bundles with SHA256 checksum files.

Two independent Node.js applications consume the library: a procurement-notice monitor downloads, verifies, shadow-tests, and switches candidate bundles, while a regulatory-knowledge sync application pins a verified version snapshot. Each application retains ownership of business rules, storage, credentials, scheduling, and notifications and reuses only the extraction and diagnostics contract.

## Immutable bundle runtimes

Store one version per immutable directory. The current and candidate runtimes may coexist so the consuming application can compare them:

```js
import { createBundleRuntime } from './web-extraction-capabilities/src/index.mjs';

const candidate = await createBundleRuntime({
  bundleDir: 'vendor/web-extraction-capabilities/0.1.3',
  expectedVersion: '0.1.3'
});
```

Use `bundle:validate` for a released artifact and `validate` for a source checkout. Central validation does not choose application fallback or promotion. If candidate creation fails, the already-loaded current runtime remains usable.

After downloading an archive from a trusted Release, verify its SHA256 against trusted checksum data obtained outside the archive before executing any archived code, including the bundled CLI. `bundle:validate` is an integrity check: it compares the manifest to the exact file and directory tree, rejects extra files, empty directories, and symbolic links, and verifies file hashes and `package.json` identity. It does not establish artifact authenticity by itself.

`createBundleRuntime({ validate: false })` is only for an already-trusted immutable local Bundle. It skips the actual-tree and file-content hash checks only; manifest format and structure, hash-field shapes, capability summaries, `expectedVersion`, and module-version equality remain enforced.

## Direct routing for Chinese public-sector sites

Chinese government, government-department, and public-institution targets require a direct route even when `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, or a global system proxy is configured. Every consuming application must enforce this in its network layer with an explicit direct dispatcher or complete `NO_PROXY` coverage for all target hosts. It must never silently fall back to a proxy and must emit an application-visible diagnostic when the direct route fails.

The central library defines this contract only; it does not classify government sites or change fetch behavior. It cannot guarantee route selection when a consumer replaces the process-global dispatcher, so route enforcement and host-by-host verification remain application integration responsibilities.

## Choose an update mode

Stable GitHub Releases include a versioned bundle and SHA256 file, so consuming applications can check for newer versions. This repository does not require applications to install an automatic updater.

During integration, the developer or executing agent should tell the user that version checking is available and ask them to choose:

1. **Automatic checks**: the application checks stable Releases on a user-approved schedule; automatic activation is a separate choice.
2. **Manual checks**: the application keeps an update command or workflow but creates no schedule.
3. **No checks for now**: the application stays pinned to the current bundle until the user requests an upgrade.

Without an explicit choice, do not create a scheduled task, download updates, or switch versions automatically. See [Upgrades](docs/upgrades.md) for the guarded update flow.

## Website references and capability feedback

When an application encounters an unsupported website type, it should validate the implementation locally, then contribute either a `verifiedTargets` entry for an existing capability or a new generic, platform-family, or explicitly site-specific capability. The contribution must include a public reference URL, verification date, sanitized fixture or repeatable test evidence, and failure diagnostics.

After the central repository publishes a stable version, consuming applications check `bundleFormatVersion`, compare `catalogSha256`, inspect added or changed capabilities and website references, rerun URL matching for configured sites, and shadow-test any changed routing before use. Applications that predate this update protocol need a one-time integration change; the central repository cannot modify them remotely. Credentials, cookies, private URLs, and business rules are never contributed.

Browser capabilities use Playwright supplied by the application. Human challenges return `HUMAN_VERIFICATION_REQUIRED`. The project is licensed under [Apache-2.0](LICENSE).
