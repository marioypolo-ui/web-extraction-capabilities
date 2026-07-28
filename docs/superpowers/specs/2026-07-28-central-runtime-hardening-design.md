# Central Runtime Hardening Design

## Goal

Prepare the central library for a v0.1.3 release that fixes three consumer-facing
gaps without changing application business rules:

1. Validate a released runtime Bundle independently from the source repository.
2. Load two immutable Bundle directories as isolated runtime instances.
3. Reduce false action-link diagnostics while preserving warnings for plausible
   records whose final URL cannot be derived.

The tender application remains responsible for keywords, dates, deduplication,
notifications, scheduling, and its no-loss merge policy.

## Non-goals

- Do not add a Guangxi University of Science and Technology suppression rule.
- Do not bypass CAPTCHA, sliders, authentication, or browser security controls.
- Do not put application configuration or fixed IP values into the central library.
- Do not make the central library update or modify consuming repositories.

## Runtime Bundle Validation

Source validation and distribution validation have different trust boundaries.
The existing `validate` command remains a strict source-repository check: capability
manifests must reference fixtures, tests, and evidence that exist in the source
tree.

Add `validateBundle({ bundleDir, expectedVersion? })` and a CLI command:

```text
web-extract bundle:validate --bundle <directory> [--expected-version <version>]
```

Bundle validation reads only `bundle-manifest.json` and validates:

- `bundleFormatVersion === 1`;
- optional expected version equality;
- safe relative paths with no traversal, absolute paths, duplicates, or links;
- every listed file exists and matches its SHA256;
- the sorted file list reproduces `bundleSha256`;
- required runtime entry points exist;
- `catalogSha256` and capability summary have valid shapes.

It intentionally does not require source-only fixtures and tests omitted from the
runtime artifact. `buildBundle` validates its output before returning. Release CI
validates the packaged artifact with `bundle:validate`, while source CI continues
to run `validate`.

## Isolated Runtime Instances

Add:

```js
const runtime = await createBundleRuntime({
  bundleDir,
  expectedVersion,
  validate: true
});
```

The factory validates the Bundle by default, imports
`<bundleDir>/src/index.mjs`, and returns an immutable object containing:

- `version`, `bundleFormatVersion`, `catalogSha256`, and `bundleDir`;
- `getCatalog()`;
- `findCapabilitiesForUrl(url)`;
- `detectCapabilities(input)`;
- `extract(input)`;
- `fetchResource(url, options)`;
- `normalizeUrl(url)`.

Two different Bundle directories produce separate ESM module instances because
their absolute module URLs differ. Bundle directories are treated as immutable;
overwriting a loaded directory is unsupported. Consumers can run current and
candidate versions against identical inputs without changing process-global state.

The factory exposes only public central APIs. It does not encode the tender
application's fallback-union policy or import application code.

## Action-link Diagnostic Precision

The current static parser warns for every `<li>` or `<article>` containing an
unresolved `javascript:`, `onclick`, or `data-id` link. This can classify paging
or navigation controls as possible missing records.

Before emitting `ACTION_LINK_REQUIRES_CONFIGURATION`, derive the visible or
metadata title and classify the block:

- ignore known navigation labels such as first/previous/next/last page and their
  English equivalents;
- ignore explicit pagination handlers such as `goPage(2)` or `changePage(2)` when
  the block has no record metadata;
- warn when the block has a publication date or `<time>`;
- warn when it has `data-id`;
- warn when the action handler indicates content navigation such as
  `open`, `show`, `view`, `detail`, `article`, or `notice`;
- warn for any remaining action-only block with a non-navigation title, because an
  unknown action must not become a silent omission;
- skip only empty controls and controls positively identified as navigation.

This is a generic structural rule, not a domain-specific exception. A real
announcement-like action fixture must continue to produce the diagnostic, while a
pagination fixture must not. An unknown custom action with a non-navigation title
must also continue to warn. The Guangxi University of Science and Technology site
remains a verified `fixed-dns-host` target; its ordinary announcement links
continue to parse normally.

## Errors And Compatibility

- New validation and runtime APIs are additive.
- Existing `validate`, `bundle`, `catalog`, `detect`, and `extract` behavior stays
  compatible except for removal of structurally unsupported navigation warnings.
- Validation failures throw explicit errors and the CLI exits nonzero with its
  existing JSON error envelope.
- Unknown Bundle formats are rejected rather than guessed.
- A failed runtime creation must not mutate or unload an already-created runtime.

## Tests

Add tests for:

- a generated Bundle passing `validateBundle`;
- corrupted file SHA256, path traversal, duplicate path, unsupported format, and
  missing runtime entry point being rejected;
- `bundle:validate` succeeding on a generated artifact without source fixtures or
  tests;
- two Bundle directories returning independent runtime metadata and extraction
  results;
- a failed candidate runtime leaving the current runtime usable;
- action-only pagination producing no warning;
- an action-only record with date, `data-id`, or a content handler still producing
  `ACTION_LINK_REQUIRES_CONFIGURATION`;
- an unknown action with a non-navigation title still producing the diagnostic;
- existing static, fixed-DNS, catalog, bundle, contribution, and documentation
  tests remaining green with no skip or todo.

## Delivery

Update public API documentation, integration guidance, upgrade guidance, and the
changelog/progress record. After full tests, sensitive-content audit, documented
command smoke tests, standalone Bundle validation, and release artifact checksum
verification pass, publish v0.1.3. Consuming applications may then run their own
guarded update check; the central repository does not force adoption.
