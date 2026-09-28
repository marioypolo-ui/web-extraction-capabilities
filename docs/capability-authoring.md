# 开发和反馈新能力

## 应用先解决，中央独立验收

网络、站点、账号、URL/应用配置和业务规则留在应用处理；原因未知不能标记中央缺陷。能力缺口由应用维护 agent 在应用自有适配层定位、修复和测试，计划任务不得自行改生产代码。中央接收可复用成果，再独立验证、通用化和发布。

普通使用与失败不自动上传数据。报告留在应用本地，优先贡献合成或最小脱敏样本；真实网站、栏目清单、来源身份也需明确公开授权。`sanitized:true`、网址公开、校验通过或文件哈希均不代表具备公开许可。审查必须在发出内容之前完成，GitHub 事后检查无法阻止首次泄露。

当前源码新增的贡献接口尚未发布，固定旧 Release 的应用先查询候选版本，不猜测接口：

```powershell
node bin/web-extract.mjs contribution:protocol
node bin/web-extract.mjs contribution:validate --contribution dist/contribution
```

`contribution:validate` 重新核对实际文件、哈希、隐私和声明，不信任包内 `passed`、`acceptance` 或 `disclosure`。`ready-for-independent-validation` 只表示静态检查通过，`verifiedContribution` 仍为 `false`；不得据此修改能力目录为 supported/reusable。缺少新契约的历史包返回 `needs-evidence`，补证据后重新验证。拒收退出码为 1，静态检查通过为 0；必须同时读取状态。

本地打包默认 `local-only`。API 的 `publicationReview` 是针对具体文件内容的人工审查/授权声明，不是中央测试凭证，也不能证明完整脱敏；内容变化后旧审查失效。新独立测试与接收流程尚在实现，当前静态通过不构成完整验收。

## 目录

从 `examples/capability-contribution` 复制一份，至少包含：

- `capability.json`：稳定 ID、版本、类型、范围、识别特征、要求和文件映射。
- `adapter.mjs`：实现代码。
- 脱敏 fixture。
- 真实行为测试。

能力范围使用：

- `generic`：不依赖单一组织或域名。
- `platform-family`：同一 CMS、接口协议或产品家族。
- `site-specific`：只能验证一个网站，必须明确标注。

不能自动完成的能力使用 `conditional`、`human-required` 或 `unsupported`，不得返回伪造记录。

## 反馈已验证网站

每个能力清单都包含 `verifiedTargets`。应用发现现有能力适用于新的公开网站时，可以只反馈网站参考，不必复制一套解析器。每项参考包含：

```json
{
  "name": "公开网站名称",
  "referenceUrl": "https://example.test/notices",
  "match": {
    "host": "example.test",
    "pathPrefix": "/notices"
  },
  "verification": "fixture-tested",
  "verifiedAt": "2026-07-27",
  "evidence": ["fixtures/example.html", "tests/example.test.mjs"]
}
```

验证级别：

- `fixture-tested`：有脱敏页面或接口 fixture 和自动测试，可作为复用候选。
- `live-tested`：有可复跑测试，并在标注日期实际验证过，可作为复用候选。
- `reported`：只记录已知现象或待验证网站，不参与自动路由。

执行 `node bin/web-extract.mjs catalog --url "<网站URL>"` 检查反馈结果。网站参考只允许公开 HTTP/HTTPS 地址；不得包含账号、Cookie、token、内网地址、个人信息或应用业务规则。新增网站参考必须增加证据；修改已有能力参考时递增该能力的补丁版本。

中央库没有对应方法时，先在应用内验证新能力，再贡献实现、回归测试、适用边界和样本；真实网站参考可选，没有证据不得宣称验证了真实网站。中央库发布稳定版本后，应用自主决定是否更新 Bundle；只有完成同输入比较、自己的验收和回滚准备后，才评估停用重复适配代码。

只反馈网站参考时，复制 `examples/website-reference-contribution`，不需要复制或提交中央适配器：

```powershell
node bin/web-extract.mjs contribution:pack --source examples/website-reference-contribution --output dist/reference
```

## 本地验证

```powershell
npm test
node bin/web-extract.mjs validate
node bin/web-extract.mjs contribution:pack --source examples/capability-contribution --output dist/contribution
node bin/web-extract.mjs contribution:pack --source examples/website-reference-contribution --output dist/reference
```

贡献包拒绝 `.github`、依赖清单、锁文件、符号链接和保留清单文件。输出必须是源目录之外的新目录，已有输出不会被覆盖。所有贡献集成都需要维护方审核及有效合并授权；核心运行时、CI、权限、依赖、安全规则和许可证须重点审查。打包、Issue 关闭、中央测试通过与应用采用是不同状态。

## 测试要求

测试必须证明正常提取和至少一个失败路径。API 失败、0 记录、登录、缺浏览器依赖或人工验证不得静默。fixture 只能是合成内容或已脱敏的公开页面。
# Independent verification entrypoint (unreleased source)

`verifyContribution({ contributionDir, publicationReview, baseline, image })` and
`contribution:verify` now connect the static pack checks to isolated replay. This
source implementation has not yet passed positive Linux-container end-to-end
acceptance and is not part of a newly published Release.

The trusted maintenance caller supplies `baseline.bundleDir`, `baseline.bundleSha256`
and `baseline.manifestSha256`. The last hash covers the exact bytes of
`bundle-manifest.json`, including its capability/version metadata. Obtain these
pins from an independently authenticated baseline; copying hashes from an
untrusted submitted directory does not establish trust. `image` is a preinstalled
Linux Docker image ID (`sha256:` plus 64 lowercase hex digits). The verifier
neither pulls images nor installs dependencies and never falls back to host
execution.

```text
node bin/web-extract.mjs contribution:verify --contribution <pack-directory> --baseline <trusted-bundle-directory> --baseline-sha256 <trusted-bundle-hash> --baseline-manifest-sha256 <trusted-manifest-hash> --image <pinned-local-image-id> --publication-review <review-json-file>
```

The verifier checks the captured baseline bytes, stages minimal read-only
directories, replays each identical input in separate baseline/candidate
containers, compares records and diagnostics in the host controller, then runs
the supplementary contribution tests in another container. Website references
use the existing baseline implementation. Crashes, malformed output and
site/application/unknown diagnostics cannot establish a parsing gap. Tests must
actually run in every declared test file; failures, skips, todo, cancellation and
empty files are rejected. A contributor-authored successful test alone is never
central evidence.

Receipts contain fixed reason codes and per-case indices/check booleans, not
page contents, test names or raw stdout/stderr. Missing trusted pins or isolation
returns `blocked`; legacy evidence remains `needs-evidence`; failed comparisons
are `rejected`. A successful replay without a valid content-bound publication
review returns `needs-disclosure-review`. `verified` requires all of these gates;
it still has `reusable: false` and `integrationStatus: pending-review`, because
integration review, merging, Release publication and consumer adoption are
separate decisions. A non-success receipt makes the CLI exit nonzero.

Temporary snapshots currently remain on the maintenance machine for local
diagnosis; they are not uploaded. Do not publish these directories or use them
as public Actions artifacts. Real container denial probes and positive
new-capability/fix/reference integration tests remain release blockers.
