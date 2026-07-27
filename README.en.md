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

Browser capabilities use Playwright supplied by the application. Human challenges return `HUMAN_VERIFICATION_REQUIRED`. The project is licensed under [Apache-2.0](LICENSE).
