# Web Extraction Capabilities

## Scope
- This repository contains reusable website detection, extraction, diagnostics, fixtures, and distribution tooling.
- It must not contain Feishu, tender matching, notification, scheduling, or application credentials.
- Applications own business filtering, persistence, secrets, cookies, and browser profiles.

## Commands
- `npm test`: run all tests.
- `npm run validate`: validate the capability catalog and fixtures.
- `npm run audit:sensitive`: scan tracked content for likely secrets.
- `npm run docs:smoke`: execute documented examples.

## Rules
- Silent empty success is forbidden. Failures and zero-record results require diagnostics.
- CAPTCHA and slider challenges are detected and handed to a human; they are never bypassed.
- New behavior requires tests. Skipped or todo tests are not accepted.
- Fixtures must be synthetic or sanitized.
