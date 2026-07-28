# Web Extraction Capabilities

一个面向独立应用的网页信息获取中央能力库。它把网站类型、识别特征、获取实现、失败诊断、fixture 和测试放在同一版本中。应用负责业务筛选、存储和通知，库只负责把网页转换为统一记录。

[English](README.en.md) | [集成指南](docs/integration.md) | [能力开发](docs/capability-authoring.md) | [诊断码](docs/diagnostics.md) | [升级与回滚](docs/upgrades.md)

## 设计边界

- 不静默失败：抓取失败、动态页面、0 条记录、登录、验证码和缺依赖均返回 `diagnostics`。
- 不托管秘密：账号、Cookie、token 和浏览器 Profile 由调用应用保存。
- 不绕过验证：滑块或验证码返回 `HUMAN_VERIFICATION_REQUIRED`。
- 应用独立运行：生产应用复制带 SHA256 的固定版本 bundle，不在运行时连接本仓库。
- 无业务规则：关键词、日期窗口、去重、数据库、飞书和调度不属于本库。

## 环境

- Node.js 22 或更高版本。
- HTTP、API 和静态 HTML 能力无第三方运行依赖。
- 浏览器能力由调用应用安装 `playwright`，并传入自己的会话配置。

```powershell
git clone https://github.com/marioypolo-ui/web-extraction-capabilities.git
cd web-extraction-capabilities
npm ci
npm test
```

## CLI

所有 CLI 正常输出均为 JSON，适合其他程序调用。

```powershell
node bin/web-extract.mjs catalog
node bin/web-extract.mjs validate --capability static-html-list
node bin/web-extract.mjs detect --url "https://example.test/notices" --html-file fixtures/static-list.html
node bin/web-extract.mjs extract --capability static-html-list --url "https://example.test/notices/" --html-file fixtures/static-list.html
node bin/web-extract.mjs bundle --output dist/bundle
node bin/web-extract.mjs contribution:pack --source examples/capability-contribution --output dist/contribution
node bin/web-extract.mjs contribution:pack --source examples/website-reference-contribution --output dist/reference
```

这些命令由 `npm run docs:smoke` 自动执行。完整参数见[集成指南](docs/integration.md)。

## Node API

```js
import { detectCapabilities, extract } from '@marioypolo/web-extraction-capabilities';

const detected = await detectCapabilities({ url, html });
const result = await extract({
  capabilityId: detected.recommendations[0]?.capabilityId,
  url,
  html
});
```

统一结果：

```json
{
  "records": [
    {
      "title": "Example notice",
      "url": "https://example.test/notices/1",
      "publishedAt": "2026-07-20",
      "summary": "",
      "raw": {}
    }
  ],
  "diagnostics": [],
  "capabilityId": "static-html-list",
  "capabilityVersion": "0.1.3"
}
```

## 当前能力

`catalog` 提供机器可读清单。v0.1.x 包括静态 HTML、JSON API、SPA API、复杂 JS 浏览器、点击流程、登录会话、人工验证检测、固定 DNS/Host、域名迁移、动作链接解析，以及从真实生产场景迁移的平台家族适配器。

浏览器类能力状态为 `conditional`：安装 Playwright 后可执行；未安装时返回 `CAPABILITY_DEPENDENCY_MISSING`。验证码类能力状态为 `human-required`。

查询某个网站是否已有可复用能力：

```powershell
node bin/web-extract.mjs catalog --url "https://www.gxufe.edu.cn/www/myweb/level.html"
```

`reusable: true` 表示已有 fixture 或真实运行证据，可直接进入应用自己的验证流程；`reported` 参考只用于提示风险，不会控制自动路由。`extract --capability auto` 会优先使用匹配的可复用网站参考，再用页面结构检测兜底。

## 独立应用使用

```powershell
node bin/web-extract.mjs bundle --output dist/bundle
node dist/bundle/bin/web-extract.mjs bundle:validate --bundle dist/bundle --expected-version 0.1.3
node examples/standalone-consumer/run.mjs --bundle dist/bundle --html-file fixtures/static-list.html
```

应用提交 bundle 中的 `src/`、`capabilities/`、`schemas/`、`package.json` 和 `bundle-manifest.json`，记录版本和总 SHA256。每个版本使用独立且不可变的目录：

```js
import { createBundleRuntime } from './web-extraction-capabilities/src/index.mjs';

const candidate = await createBundleRuntime({
  bundleDir: 'vendor/web-extraction-capabilities/0.1.3',
  expectedVersion: '0.1.3'
});
```

当前版本和候选版本可以同时加载，由应用比较结果。`bundle:validate` 用于发布 Bundle，`validate` 用于源码检出；中央校验不决定应用的回退或晋升策略。候选版本创建失败时，已加载的当前运行时仍可继续使用。详见[升级与回滚](docs/upgrades.md)。

## 国内政务网站直连

中国政府、政府部门和行政事业单位网站即使存在 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 或系统全局代理，也必须直连。每个调用应用必须在自己的网络层使用显式 direct dispatcher，或为全部目标主机提供完整 `NO_PROXY` 覆盖；禁止直连失败后静默改走代理，并必须输出应用可见的失败诊断。

中央库只规定该契约，不负责政府站点分类或修改 fetch 行为。若应用替换进程级全局 dispatcher，中央库无法保证路由选择，因此直连强制和逐主机验证始终由应用集成层负责。

## 更新方式选择

中央库通过 GitHub Releases 发布稳定版本、bundle 和 SHA256，因此应用可以检查是否有新版本，但中央库不会强制应用安装自动更新器。

接入本库时，开发者或执行 Agent 应主动告诉用户存在版本检查能力，并询问选择：

1. **自动检查**：由应用按用户确认的周期检查稳定 Release；是否自动切换版本需要另行确认。
2. **手动检查**：应用保留检查和升级入口，不创建定时任务。
3. **暂不检查**：应用固定使用当前 bundle，直到用户以后主动要求升级。

用户没有明确选择前，不得创建定时任务、自动下载或自动切换版本。具体安全流程见[升级与回滚](docs/upgrades.md)。

## 网站参考与能力回流

应用遇到中央库未覆盖的新网站类型时，应先在应用内实现并用脱敏 fixture、正常路径和失败路径测试验证。验证成功后：

1. 能复用现有能力时，在该能力的 `verifiedTargets` 中反馈公开网站名称、URL 匹配规则、验证日期和证据。
2. 需要新解析方法时，新增 `generic`、`platform-family` 或明确的 `site-specific` 能力，并同时登记网站参考。
3. 使用 `contribution:pack` 生成贡献包并提交中央库。
4. 中央库发布新版本后，应用检查 `bundleFormatVersion`，再比较 Bundle 的 `catalogSha256` 和能力目录，重新为已配置网站执行 URL 匹配和影子验证，再采用新能力。

这样新应用可以先查已验证网站，已接入升级协议的应用也能在定期检查 Release 后发现新增能力。尚未接入升级协议的旧应用需要一次性改造；无法靠中央库反向修改。账号、Cookie、内部地址、私有页面和业务规则不得进入网站参考。详见[能力开发](docs/capability-authoring.md)。

## 贡献新能力

复制 `examples/capability-contribution`，提供能力清单、实现、脱敏 fixture 和测试，然后执行：

```powershell
node bin/web-extract.mjs contribution:pack --source examples/capability-contribution --output dist/contribution
```

如果现有能力已经适用，只需复制 `examples/website-reference-contribution`，填写公开网站参考和验证证据：

```powershell
node bin/web-extract.mjs contribution:pack --source examples/website-reference-contribution --output dist/reference
```

中央 CI 自动检查 schema、测试、文档命令、敏感信息和 bundle 可复现性。自动合并仅对可信作者和受限路径开放；核心运行时、CI、依赖、权限和许可证始终需要人工审核。详见[贡献指南](CONTRIBUTING.md)。

## 许可证

[Apache License 2.0](LICENSE)
