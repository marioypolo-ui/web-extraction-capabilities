# Diagnostics

| Code | Meaning | Application action |
|---|---|---|
| `ZERO_RECORDS` | Extraction produced no records | Treat as a verification risk, not “no new data” |
| `FETCH_FAILED` | Network, DNS, timeout, or connection failure | Retry and alert with the source URL |
| `HTTP_ERROR` | Non-success HTTP status | Record status and verify access policy |
| `INVALID_JSON` | Endpoint response is not valid JSON | Verify endpoint and response encoding |
| `API_RESPONSE_SHAPE_MISMATCH` | Configured list path is not an array | Update the field mapping |
| `UNSUPPORTED_STRUCTURE` | No known structure was detected | Add a capability or use a browser workflow |
| `DYNAMIC_RENDERING_REQUIRED` | HTML is an empty application shell | Configure SPA API or browser extraction |
| `DYNAMIC_CONFIGURATION_REQUIRED` | SPA endpoint mapping is missing | Supply `apiUrl` and JSON field mapping |
| `ACTION_LINK_REQUIRES_CONFIGURATION` | Link uses javascript/onclick/data-id | Supply `actionUrlTemplate` or browser steps |
| `CAPABILITY_DEPENDENCY_MISSING` | Playwright is not installed | Install it in the consuming application |
| `AUTH_SESSION_REQUIRED` | Authorized application session is missing | Supply application-owned state or CDP session |
| `HUMAN_VERIFICATION_REQUIRED` | CAPTCHA or slider detected | Pause for an authorized human; do not bypass |
| `BROWSER_EXECUTION_FAILED` | Browser navigation or click failed | Preserve details, retry safely, alert if repeated |
| `MIGRATED_ADAPTER_WARNING` | A migrated platform adapter reported risk | Verify the listed platform and fixture |
| `CONFIG_INVALID` | Detail mode, field mapping, content format, or selector syntax is invalid | Correct explicit configuration before retrying |
| `CONFIG_REQUIRED` | JSON detail has no explicit content field mapping | Supply `fields.content` and the relevant object path |
| `DETAIL_CONTENT_NOT_FOUND` | No usable detail body could be selected | Inspect the page and configure its body selector or data source |
| `SELECTOR_NO_MATCH` | An explicit detail selector matched no element | Correct that selector; the configured field is not silently guessed |
| `LOW_CONFIDENCE_CONTENT` | Detail body was selected by a generic text-density fallback | Compare the returned body with the original page |
| `MALFORMED_HTML` | Detail HTML required structural recovery | Check whether paragraphs, table cells, or resources were lost |
| `INVALID_RESOURCE_URL` | An image or attachment reference cannot be safely resolved | Inspect the original link; do not execute the rejected reference |
| `EMBEDDED_CONTENT_NOT_EXTRACTED` | A detail page contains embedded content that was not read | Retrieve that source separately if authorized and needed |
| `MULTIPAGE_CONTENT_DETECTED` | Article pagination was detected, but additional pages were not fetched | Review or process the remaining pages explicitly |
| `STRUCTURED_DATA_INVALID` | Article structured data could not be parsed or used | Inspect JSON-LD and verify any body obtained by another path |
| `STRUCTURED_DATA_AMBIGUOUS` | Multiple Article JSON-LD entries cannot be uniquely tied to the current page | Supply an explicit body selector or correct the page identity metadata |
| `STRUCTURED_DATA_URL_MISMATCH` | The Article JSON-LD explicitly identifies a different page | Verify the source URL and prefer the current page's visible body |
| `DETAIL_API_FAILED` | A supported platform detail API could not supply its body | Inspect the platform response and the associated diagnostic |
| `DETAIL_EXTRACTION_FAILED` | Detail extraction stopped unexpectedly | Verify input types and configuration, then preserve a sanitized reproduction |
| `UNSUPPORTED_CONTENT_TYPE` | The response is not a supported HTML or JSON detail resource | Use a separate document or media parser |

Every result includes diagnostics. Applications should persist and surface error and human-required diagnostics immediately.

The `detail` command and `extractDetail()` API return `{ document, diagnostics, capabilityId, capabilityVersion }`, independently of the list `records` contract. A missing detail body is `document: null` with diagnostics, never silent empty success. A non-null document can still include incompleteness warnings, so applications must inspect both fields. `API_RESPONSE_SHAPE_MISMATCH` also covers a configured detail object or image/attachment array with an unusable shape.

Detail `ACTION_LINK_REQUIRES_CONFIGURATION` identifies a likely attachment or action link without a usable ordinary URL. The library does not execute JavaScript URLs to resolve it. `AUTH_SESSION_REQUIRED`, `HUMAN_VERIFICATION_REQUIRED`, and missing-browser diagnostics also apply to details. A browser is only attempted with explicit `mode: "browser"` or `browserFallback: true`; it is not an automatic escape from a login or human challenge. See [Detail extraction](detail-extraction.md) for supported configuration and limits.

For list extraction, `ACTION_LINK_REQUIRES_CONFIGURATION` applies only when an unresolved action link is a plausible record. Record evidence such as a publication date, `<time>`, `data-id`, or a content-oriented action handler always takes priority and emits the diagnostic, including inside navigation containers.

Without record evidence, empty controls and known paging/mobile controls may be ignored. A record-free control may also be ignored when it is inside `<nav>` or when an ancestor's `class`, `id`, or `role` contains an independent `nav`, `navigation`, `menu`, `header`, `breadcrumb`, `pagination`, or `pager` token. The same token check applies to the current `<li>` or `<article>` root. Remaining titled action-only blocks stay diagnosed.

Only complete, closed HTML comments are masked during structural ancestry checks, using equal-length spaces to preserve indexes. Tag-like text inside comments cannot create navigation ancestors, and an unclosed `<!--` marker does not hide later DOM. These are generic rules; there is no GXUST-specific suppression.

Chinese government, government-department, and public-institution targets require a direct route even when `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, or a global system proxy is configured. The consuming application's network layer must bypass those proxies with an explicit direct dispatcher or complete `NO_PROXY` coverage.

If the direct route fails, the application must emit an application-visible fetch diagnostic and must never silently retry or fall back through a proxy. The central library defines this contract only; the consuming application's network layer is responsible for enforcing it.
