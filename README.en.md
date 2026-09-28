# Web Extraction Capabilities

An executable catalog of reusable website detection, extraction, diagnostics, fixtures, and tests. Applications keep ownership of business filtering, storage, credentials, scheduling, and notifications.

## Extract a detail page

Supply an article, announcement, or policy page URL:

```powershell
node bin/web-extract.mjs detail --url "https://example.test/articles/1"
```

Replace the example URL with the target. In `v0.2.0`, `detail` and the exported `extractDetail({ url })` API return a `document` with its title, full content text, publication date, structured tables, image URLs, attachment links, and diagnostics. Full content is not limited to the 500-character list summary. Existing HTML can be supplied with `--html-file` for offline extraction. WorkBuddy and other executing agents can discover this public command here and follow the [Detail extraction guide](docs/detail-extraction.md), without requiring users to name internal source files.

The default does not launch a browser. Unknown layouts may need a content selector; unknown JSON APIs require explicit field mapping. Browser execution requires application-supplied Playwright and explicit browser mode or fallback. The new generic capability uses synthetic fixtures and has no new verified live detail targets; it does not guarantee coverage of every website.

## Application agent integration and problem feedback

Give WorkBuddy or another application agent this request:

> Use https://github.com/marioypolo-ui/web-extraction-capabilities to integrate list and detail extraction into my application using a verified, pinned Release. Diagnose failures locally; the application maintenance agent resolves and tests capability gaps before contributing reusable implementations, regression tests, minimal fixtures or website references. Share only content reviewed and authorized for public disclosure. Keep network, account and business-configuration problems in the application. Adopt central releases through the application's own acceptance and rollback policy.

Version `v0.3.0` adds verified contribution intake, isolated validation and status contracts, with privacy review before disclosure and no automatic usage uploads. The `v0.2.0` `feedback:validate` and `feedback:reproduce` APIs remain available for local diagnosis; the legacy public report-and-central-repair entrypoint is retired. See [diagnosis and migration](docs/problem-feedback.md). Older pinned Releases do not gain new interfaces automatically. Packaging or static validation does not mean independent tests, merge, publication, or application adoption succeeded.

Application upgrades, production acceptance and notifications remain in the application task. Offline evidence does not verify the live browser, session or network, and automatic repair of every unknown website is not guaranteed.

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
node bin/web-extract.mjs detail --url "https://example.test/articles/1" --html-file fixtures/detail-article.html
node bin/web-extract.mjs feedback:validate --report examples/problem-feedback/detail.json
node bin/web-extract.mjs feedback:reproduce --report examples/problem-feedback/detail.json
node bin/web-extract.mjs bundle --output dist/bundle
```

See [Detail extraction](docs/detail-extraction.md), [Problem feedback](docs/problem-feedback.md), [Integration](docs/integration.md), [Diagnostics](docs/diagnostics.md), [Capability authoring](docs/capability-authoring.md), and [Upgrades](docs/upgrades.md).

Detail extraction has a separate [`document` result schema](schemas/detail-result.schema.json). Existing `extract()` consumers keep their `records` contract. Output contains plain text and resource references, not executable HTML; render text fields as text. Attachments are not downloaded or parsed, and PDF, Word, OCR, embedded-frame extraction, and automatic article pagination are outside this capability.

Use `node bin/web-extract.mjs catalog --url "<url>"` to find verified website references. Reusable references can guide automatic routing; reported-only references never control it.

## Real-world usage and project evidence

As of `v0.1.3`, the catalog contains 11 machine-readable capability classes, 14 public website references backed by live tests or sanitized fixtures, and one reported-only reference for human-verification risk. Release gates include 122 automated tests, and GitHub Releases ship standalone bundles with SHA256 checksum files.

Two independent Node.js applications consume the library: a procurement-notice monitor downloads, verifies, shadow-tests, and switches candidate bundles, while a regulatory-knowledge sync application pins a verified version snapshot. Each application retains ownership of business rules, storage, credentials, scheduling, and notifications and reuses only the extraction and diagnostics contract.

## Immutable bundle runtimes

Store one version per immutable directory. The current and candidate runtimes may coexist so the consuming application can compare them:

```js
import { createBundleRuntime } from './web-extraction-capabilities/src/index.mjs';

const candidate = await createBundleRuntime({
  bundleDir: 'vendor/web-extraction-capabilities/0.3.0',
  expectedVersion: '0.3.0'
});
```

Use `bundle:validate` for a released artifact and `validate` for a source checkout. Central validation does not choose application fallback or promotion. If candidate creation fails, the already-loaded current runtime remains usable.

To run the offline detail consumer after creating a Bundle:

```powershell
node dist/bundle/bin/web-extract.mjs bundle:validate --bundle dist/bundle --expected-version 0.3.0
node examples/detail-consumer/run.mjs --bundle dist/bundle --url "https://example.test/articles/1" --html-file fixtures/detail-article.html
```

Before using details through a bundle runtime, check `typeof candidate.extractDetail === 'function'`; an older Bundle can still load without exposing the new API.

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

Applications can [report extraction problems](docs/problem-feedback.md) with sanitized evidence before implementing a fix. When contributing an implementation, validate it locally, then contribute either a `verifiedTargets` entry for an existing capability or a new generic, platform-family, or explicitly site-specific capability. The contribution must include a public reference URL, verification date, sanitized fixture or repeatable test evidence, and failure diagnostics.

After the central repository publishes a stable version, consuming applications check `bundleFormatVersion`, compare `catalogSha256`, inspect added or changed capabilities and website references, rerun URL matching for configured sites, and shadow-test any changed routing before use. Applications that predate this update protocol need a one-time integration change; the central repository cannot modify them remotely. Credentials, cookies, private URLs, and business rules are never contributed.

Browser capabilities use Playwright supplied by the application. Human challenges return `HUMAN_VERIFICATION_REQUIRED`. The project is licensed under [Apache-2.0](LICENSE).
