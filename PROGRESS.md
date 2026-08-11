# Progress

- Goal: publish a standalone Apache-2.0 web extraction capability library.
- Source tender project is read-only at commit `795d0b13c78d673baa2271c4de43bfbea5e120ca`.
- Source baseline: 78 passed, 0 failed, 0 skipped, 0 todo.
- Implemented: 11 capability classes, unified JSON CLI, bundle/contribution packaging, docs, CI, and release workflows.
- Guardrail: failures, empty extraction, missing dependencies, authentication, and human verification emit structured diagnostics.
- Current verification: v0.1.3 local release readiness and the GXUST direct-route regression passed.
- Public repository: https://github.com/marioypolo-ui/web-extraction-capabilities
- Latest stable baseline: immutable `v0.1.2` tag with bundle and SHA256 assets.
- `v0.1.2` adds verified website references, URL catalog lookup, target-only contribution packs, catalog-aware bundles, and automatic reusable-capability routing.
- Release status: `v0.1.2` passed CI, release asset checksum verification, and standalone bundle execution.
- v0.1.3 local preparation adds standalone Bundle self-validation, immutable current/candidate runtime guidance, action-link diagnostic clarification, and mandatory direct routing for Chinese government/public-institution targets.
- GXUST direct regression (2026-07-28): `curl.exe --noproxy "*"` fetched `https://www.gxust.edu.cn/xwzx/zbgs.htm` to the system temporary directory (`27,030` bytes). Current v0.1.3 HEAD produced `52` total records, `10` dated announcement records, `0` `ACTION_LINK_REQUIRES_CONFIGURATION` diagnostics, and an empty diagnostics array; the first three announcement titles, URLs, and dates were normal. No live HTML, IP configuration, Cookie, or credential was committed.
- v0.1.3 status: local preparation, validation, and GXUST direct regression passed; no tag or GitHub Release has been created.
