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

Every result includes diagnostics. Applications should persist and surface error and human-required diagnostics immediately.

`ACTION_LINK_REQUIRES_CONFIGURATION` applies only when an action link is a plausible record. Explicit pagination and mobile-view controls are navigation controls and are ignored instead of being reported as unresolved records.

Chinese government, government-department, and public-institution targets require a direct route even when `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, or a global system proxy is configured. The consuming application's network layer must bypass those proxies with an explicit direct dispatcher or complete `NO_PROXY` coverage.

If the direct route fails, the application must emit an application-visible fetch diagnostic and must never silently retry or fall back through a proxy. The central library defines this contract only; the consuming application's network layer is responsible for enforcing it.
