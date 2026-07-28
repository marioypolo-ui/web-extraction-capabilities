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

The static parser classifies every `<li>` or `<article>` containing an unresolved
`javascript:`, `onclick`, or `data-id` link before emitting
`ACTION_LINK_REQUIRES_CONFIGURATION`. The generic decision order is:

- derive the visible or metadata title and record evidence first;
- treat a publication date, `<time>`, `data-id`, or a content handler such as
  `open`, `show`, `view`, `detail`, `article`, or `notice` as record evidence;
- always warn when record evidence exists, including inside navigation contexts;
- when no record evidence exists, ignore an empty control or a control with a
  known navigation label;
- when no record evidence exists, ignore a control inside a semantic `<nav>` or
  an ancestor whose `class`, `id`, or `role` contains an independent
  `nav`/`navigation`/`menu`/`header`/`breadcrumb`/`pagination`/`pager` token;
- apply the same navigation-token check to the current `<li>` or `<article>` root,
  not only its ancestors;
- warn for every remaining titled action-only block, because an unknown action
  must not become a silent omission.

Structural ancestry is computed from HTML with only complete, closed
`<!-- ... -->` comments masked. Each closed comment is replaced with equal-length
spaces so block indexes remain stable; tag-like text inside comments therefore
cannot create false ancestors. An unclosed `<!--` marker is not treated as a
comment spanning the remainder of the document, so it cannot hide later DOM.

These are generic structural rules with no Guangxi University of Science and
Technology special case. The site remains a verified `fixed-dns-host` target, and
its ordinary announcement links continue to parse normally.

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
- empty controls and record-free controls in semantic or tokenized navigation
  contexts producing no action-link diagnostic;
- navigation tokens on the current `<li>` or `<article>` root being recognized
  without overriding record evidence;
- closed comment pseudo-tags and unclosed comment markers not corrupting
  structural ancestry or hiding later content;
- existing static, fixed-DNS, catalog, bundle, contribution, and documentation
  tests remaining green with no skip or todo.

## Delivery

Update public API documentation, integration guidance, upgrade guidance, and the
changelog/progress record. After full tests, sensitive-content audit, documented
command smoke tests, standalone Bundle validation, and release artifact checksum
verification pass, publish v0.1.3. Consuming applications may then run their own
guarded update check; the central repository does not force adoption.
