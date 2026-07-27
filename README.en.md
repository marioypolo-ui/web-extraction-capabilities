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
